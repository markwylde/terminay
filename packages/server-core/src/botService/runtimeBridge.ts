import { randomBytes, timingSafeEqual } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import type { JsonValue } from '@terminay/protocol';
import type { BotCredentialLease } from './credentials.js';
import { BOT_KILL_DEADLINE_MS, type EngineDriver } from './engine.js';
import { BOT_RUNTIME_TOOLS, type BotExecutionRuntime } from './runtime.js';
import type { BotTerminayMcpHandler } from './service.js';
import { BotError, object } from './store.js';
import { BotTokenRedactor } from './tokens.js';

export interface BotRuntimeBridge {
	readonly servers: readonly JsonValue[];
	readonly environment: Readonly<Record<string, string>>;
	assertConnected(): void;
	wrapCredential(credential: BotCredentialLease): BotCredentialLease;
	close(): Promise<void>;
}
/** Execution-bound container relay. It never dispatches the workspace MCP registry. */
export async function openBotRuntimeBridge(
	driver: EngineDriver,
	botId: string,
	sessionId: string,
	runtime: BotExecutionRuntime,
	onDiagnostic?: (value: string) => void,
	/** Opens the execution's Terminay MCP, when the bot has access (ADR-0100). */
	terminay?: () => BotTerminayMcpHandler | undefined,
): Promise<BotRuntimeBridge> {
	const token = randomBytes(32).toString('hex'),
		socket = `/tmp/terminay-mcp-${sessionId}.sock`,
		supervisor = `mcp-${sessionId}`;
	const unbind = runtime.bindSecret(sessionId, token);
	let stream: ReturnType<EngineDriver['execStream']>;
	try {
		stream = driver.execStream(
			`terminay-bot-${botId}`,
			['terminay-run', supervisor, '--', 'terminay-mcp-relay', sessionId],
			{ user: 'root' },
		);
	} catch (error) {
		unbind();
		throw error;
	}

	const diagnostic = (value: string) =>
		runtime
			.sanitizeSecrets(botId, value.split(token).join('[redacted]'))
			.slice(-8192);
	let stderr = '';
	const stderrDecoder = new StringDecoder('utf8');
	const decoder = new StringDecoder('utf8');
	let buffer = '',
		closed = false,
		closeTask: Promise<void> | undefined;
	const requests = new Map<string, AbortController>();
	const initialized = new Set<number>();
	let connected = false;
	const lifetime = new AbortController();
	let readyResolve: () => void, readyReject: (e: Error) => void;
	const ready = new Promise<void>((resolve, reject) => {
		readyResolve = resolve;
		readyReject = reject;
	});
	const send = (connection: number, message: unknown) => {
		if (closed || lifetime.signal.aborted) return;
		if (stream.stdin.writableLength > 262144) {
			finish();
			stream.kill();
			return;
		}
		const line = `${JSON.stringify({ connection, message })}\n`;
		if (Buffer.byteLength(line) > 131072)
			throw new Error('MCP response exceeds relay limit');
		stream.stdin.write(line);
	};
	const finish = () => {
		lifetime.abort();
		for (const controller of requests.values()) controller.abort();
		readyReject(
			new Error(
				'Bot MCP relay closed before readiness' +
					(stderr ? `: ${diagnostic(stderr)}` : ''),
			),
		);
	};
	stream.once('error', finish);
	stream.once('close', finish);
	stream.stdin.on('error', finish);
	stream.stderr.on('data', (chunk: Buffer) => {
		stderr = (stderr + stderrDecoder.write(chunk)).slice(-8192);
	});
	const handle = async (raw: unknown) => {
		const frame = object(raw);
		if (frame.ready === true) {
			readyResolve();
			return;
		}
		const connection = frame.connection;
		if (!Number.isSafeInteger(connection) || Number(connection) < 1) return;
		// The relay says an adapter disconnected: end only its requests.
		if (frame.closed === true) {
			for (const [key, controller] of requests)
				if (key.startsWith(`${connection}:`)) controller.abort();
			initialized.delete(Number(connection));
			return;
		}
		const request = object(frame.message),
			requestId = request.id;
		if (
			requestId !== undefined &&
			!(
				(typeof requestId === 'string' && requestId.length <= 128) ||
				(typeof requestId === 'number' && Number.isSafeInteger(requestId))
			)
		)
			return;
		const reply = (result: unknown) => {
			if (requestId !== undefined)
				send(Number(connection), { jsonrpc: '2.0', id: requestId, result });
		};
		const error = (code: number, message: string) => {
			if (requestId !== undefined)
				send(Number(connection), {
					jsonrpc: '2.0',
					id: requestId,
					error: { code, message },
				});
		};
		const supplied = Buffer.from(
			typeof frame.token === 'string' ? frame.token : '',
		);
		const expected = Buffer.from(token);
		if (
			supplied.length !== expected.length ||
			!timingSafeEqual(supplied, expected)
		) {
			error(-32600, 'Execution capability refused');
			return;
		}
		const key = `${connection}:${String(requestId)}`;
		try {
			runtime.assert(sessionId);
			if (request.method === 'notifications/cancelled') {
				const params = object(request.params);
				requests.get(`${connection}:${String(params.requestId)}`)?.abort();
				return;
			}
			if (
				typeof request.method === 'string' &&
				request.method.startsWith('notifications/')
			)
				return;
			if (request.method === 'initialize') {
				if (initialized.size >= 8)
					initialized.delete(initialized.values().next().value!);
				initialized.add(Number(connection));
				const params = object(request.params ?? {});
				const version = ['2024-11-05', '2025-03-26', '2025-06-18'].includes(
					String(params.protocolVersion),
				)
					? params.protocolVersion
					: '2024-11-05';
				reply({
					protocolVersion: version,
					capabilities: { tools: {} },
					serverInfo: { name: 'terminay-bot-runtime', version: '1' },
				});
				return;
			}
			if (request.method === 'ping') {
				reply({});
				return;
			}
			if (request.method === 'tools/list') {
				if (initialized.has(Number(connection)) && !connected) {
					connected = true;
					onDiagnostic?.(
						'Agent connected to terminay_bot and loaded its tools.',
					);
				}
				reply({ tools: BOT_RUNTIME_TOOLS });
				return;
			}
			if (request.method === 'runtime/check-work') {
				runtime.assertWork(sessionId);
				reply({ owned: true });
				return;
			}
			if (request.method !== 'tools/call') {
				error(-32601, 'Unknown bot runtime method');
				return;
			}
			if (requests.size >= 16 || requests.has(key)) {
				error(-32600, 'Too many outstanding or duplicate requests');
				return;
			}
			const params = object(request.params),
				controller = new AbortController();
			requests.set(key, controller);
			const abort = () => controller.abort();
			lifetime.signal.addEventListener('abort', abort, { once: true });
			try {
				const value = await runtime.call(
					sessionId,
					String(params.name),
					params.arguments ?? {},
					controller.signal,
				);
				reply({ content: [{ type: 'text', text: JSON.stringify(value) }] });
			} catch (e) {
				reply({
					isError: true,
					content: [
						{
							type: 'text',
							text:
								e instanceof BotError
									? e.message.slice(0, 1024)
									: 'Bot runtime operation failed',
						},
					],
				});
			} finally {
				requests.delete(key);
				lifetime.signal.removeEventListener('abort', abort);
			}
		} catch (e) {
			error(
				-32600,
				e instanceof BotError
					? e.message.slice(0, 1024)
					: 'Invalid bot runtime request',
			);
		}
	};
	stream.stdout.on('data', (bytes: Buffer) => {
		buffer += decoder.write(bytes);
		for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
			if (Buffer.byteLength(buffer.slice(0, at)) > 131072) {
				finish();
				stream.kill();
				return;
			}
			const line = buffer.slice(0, at);
			buffer = buffer.slice(at + 1);
			if (!line.trim()) continue;
			try {
				void handle(JSON.parse(line)).catch(() => finish());
			} catch {
				finish();
				stream.kill();
			}
		}
		if (Buffer.byteLength(buffer) > 131072) {
			finish();
			stream.kill();
		}
	});
	const close = () => {
		if (closeTask) return closeTask;
		closed = true;
		finish();
		unbind();
		closeTask = (async () => {
			stream.stdin.end();
			try {
				await driver.exec(
					`terminay-bot-${botId}`,
					['terminay-run', '--kill', supervisor],
					{ user: 'root', deadlineMs: BOT_KILL_DEADLINE_MS },
				);
			} finally {
				stream.kill();
			}
		})();
		return closeTask;
	};
	const timer = setTimeout(
		() =>
			readyReject(
				new Error(
					'Bot MCP relay readiness deadline' +
						(stderr ? `: ${diagnostic(stderr)}` : ''),
				),
			),
		10000,
	);
	try {
		await ready;
		try {
			await driver.exec(
				`terminay-bot-${botId}`,
				['/usr/local/bin/terminay-bot-mcp', '--check-runtime'],
				{
					user: 'bot',
					env: {
						TERMINAY_RUNTIME_SOCKET: socket,
						TERMINAY_RUNTIME_TOKEN: token,
					},
					environmentNames: [
						'TERMINAY_RUNTIME_SOCKET',
						'TERMINAY_RUNTIME_TOKEN',
					],
					deadlineMs: 10000,
					onOutput: (chunk, source) => {
						if (source === 'stderr' && chunk.trim())
							onDiagnostic?.(diagnostic(`Adapter startup: ${chunk}`));
					},
				},
			);
		} catch {
			throw new BotError(
				'unavailable',
				'The terminay_bot MCP adapter could not connect to its runtime. Rebuild the bot image and recreate the environment; see Runner output for details.',
			);
		}
	} catch (error) {
		onDiagnostic?.(
			diagnostic(
				error instanceof Error ? error.message : 'Bot MCP relay startup failed',
			),
		);
		await close().catch(() => undefined);
		throw error;
	} finally {
		clearTimeout(timer);
	}
	// Terminay MCP is optional: when it cannot be set up, the execution runs
	// with its runtime tools and says so in Runner output.
	let terminayRelay: TerminayRelay | undefined;
	if (terminay !== undefined) {
		try {
			terminayRelay = await openTerminayRelay(
				driver,
				botId,
				sessionId,
				runtime,
				terminay,
			);
		} catch (error) {
			onDiagnostic?.(
				diagnostic(
					`Terminay MCP is unavailable for this execution: ${
						error instanceof Error ? error.message : 'it could not start'
					}`,
				),
			);
		}
	}
	const closeAll = async () => {
		const results = await Promise.allSettled([terminayRelay?.close(), close()]);
		for (const result of results)
			if (result.status === 'rejected')
				logRelayCleanupFailure(botId, sessionId, result.reason);
	};
	const secrets = [token, ...(terminayRelay ? [terminayRelay.secret] : [])];
	const environment = {
		BASH_ENV: '/usr/local/bin/terminay-shell-env',
		TERMINAY_RUNTIME_SOCKET: socket,
		TERMINAY_RUNTIME_TOKEN: token,
		...terminayRelay?.environment,
	};
	return {
		servers: [
			{
				name: 'terminay_bot',
				command: '/usr/local/bin/terminay-bot-mcp',
				args: [],
				env: Object.entries({
					BASH_ENV: '',
					TERMINAY_RUNTIME_SOCKET: socket,
					TERMINAY_RUNTIME_TOKEN: token,
				}).map(([name, value]) => ({
					name,
					value,
				})),
			},
			{
				name: 'terminay_desktop',
				command: '/usr/local/bin/terminay-desktop-mcp.mjs',
				args: ['--endpoint=http://127.0.0.1:9223'],
				env: [],
			},
			{
				name: 'terminay_browser',
				command: '/usr/local/bin/terminay-desktop-mcp.mjs',
				args: [
					'--cap-output',
					'--',
					'chrome-devtools-mcp',
					'--browser-url=http://127.0.0.1:9223',
				],
				env: [],
			},
			...(terminayRelay === undefined ? [] : [terminayRelay.server]),
		],
		environment,
		close: closeAll,
		assertConnected: () => {
			if (!connected)
				throw new BotError(
					'unavailable',
					'The agent did not connect to terminay_bot and load its tools. Rebuild the bot image and recreate the environment; see Runner output for MCP startup details.',
				);
		},
		wrapCredential: (credential) => ({
			...credential,
			redact: (value) =>
				secrets.reduce(
					(text, secret) => text.split(secret).join('[redacted]'),
					credential.redact(value),
				),
			stream: () => {
				const first = credential.stream(),
					second = new BotTokenRedactor(secrets),
					decoder = new StringDecoder('utf8');
				return {
					push: (chunk) => decoder.write(second.push(first.push(chunk))),
					finish: () =>
						decoder.end(
							Buffer.concat([second.push(first.finish()), second.finish()]),
						),
				};
			},
		}),
	};
}

interface TerminayRelay {
	readonly secret: string;
	/** The relay's own pair, carried by the agent process for its adapter. */
	readonly environment: Readonly<Record<string, string>>;
	readonly server: JsonValue;
	close(): Promise<void>;
}

/**
 * The execution's `terminay` relay (ADR-0100): its own supervised exec, socket
 * and secret, so the container never holds the capability token. Each frame's
 * secret is checked before the host's Terminay MCP sees it, which serves one
 * MCP session per adapter connection.
 */
async function openTerminayRelay(
	driver: EngineDriver,
	botId: string,
	sessionId: string,
	runtime: BotExecutionRuntime,
	openHandler: () => BotTerminayMcpHandler | undefined,
): Promise<TerminayRelay | undefined> {
	const relayId = randomBytes(12).toString('hex'),
		secret = randomBytes(32).toString('hex'),
		socket = `/tmp/terminay-mcp-${relayId}.sock`,
		supervisor = `mcp-terminay-${relayId}`;
	const handler = openHandler();
	if (handler === undefined) return undefined;
	const unbind = runtime.bindSecret(sessionId, secret, `${sessionId}:terminay`);
	let stream: ReturnType<EngineDriver['execStream']>;
	try {
		stream = driver.execStream(
			`terminay-bot-${botId}`,
			['terminay-run', supervisor, '--', 'terminay-mcp-relay', relayId],
			{ user: 'root' },
		);
	} catch (error) {
		handler.close();
		unbind();
		throw error;
	}
	const expected = Buffer.from(secret);
	const decoder = new StringDecoder('utf8');
	let buffer = '',
		closed = false,
		closeTask: Promise<void> | undefined;
	let readyResolve!: () => void, readyReject!: (e: Error) => void;
	const ready = new Promise<void>((resolve, reject) => {
		readyResolve = resolve;
		readyReject = reject;
	});
	// A rejection before anyone awaits it must not go unhandled.
	ready.catch(() => undefined);
	const send = (connection: number, message: unknown) => {
		if (closed) return;
		if (stream.stdin.writableLength > 262144) {
			void close();
			return;
		}
		let line = `${JSON.stringify({ connection, message })}\n`;
		if (Buffer.byteLength(line) > 131072) {
			const id = (message as { id?: unknown }).id;
			if (id === undefined) return;
			line = `${JSON.stringify({
				connection,
				message: {
					jsonrpc: '2.0',
					id,
					error: { code: -32603, message: 'MCP response exceeds relay limit' },
				},
			})}\n`;
		}
		stream.stdin.write(line);
	};
	const handle = (raw: unknown) => {
		const frame = object(raw);
		if (frame.ready === true) {
			readyResolve();
			return;
		}
		const connection = frame.connection;
		if (!Number.isSafeInteger(connection) || Number(connection) < 1) return;
		if (frame.closed === true) {
			handler.closeConnection(Number(connection));
			return;
		}
		const supplied = Buffer.from(
			typeof frame.token === 'string' ? frame.token : '',
		);
		if (
			supplied.length !== expected.length ||
			!timingSafeEqual(supplied, expected)
		) {
			const message = frame.message;
			const id =
				message && typeof message === 'object' && !Array.isArray(message)
					? (message as { id?: unknown }).id
					: undefined;
			if (id !== undefined)
				send(Number(connection), {
					jsonrpc: '2.0',
					id,
					error: { code: -32600, message: 'Execution capability refused' },
				});
			return;
		}
		handler.handle(Number(connection), frame.message, (message) =>
			send(Number(connection), message),
		);
	};
	const close = (): Promise<void> => {
		if (closeTask) return closeTask;
		closed = true;
		readyReject(new Error('Terminay MCP relay closed before readiness'));
		handler.close();
		unbind();
		closeTask = (async () => {
			stream.stdin.end();
			try {
				await driver.exec(
					`terminay-bot-${botId}`,
					['terminay-run', '--kill', supervisor],
					{ user: 'root', deadlineMs: BOT_KILL_DEADLINE_MS },
				);
			} catch (error) {
				// The exec stream is killed below either way.
				logRelayCleanupFailure(botId, `terminay-${sessionId}`, error);
			} finally {
				stream.kill();
			}
		})();
		return closeTask;
	};
	stream.once('error', () => void close());
	stream.once('close', () => void close());
	stream.stdin.on('error', () => void close());
	stream.stdout.on('data', (bytes: Buffer) => {
		buffer += decoder.write(bytes);
		for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
			const line = buffer.slice(0, at);
			buffer = buffer.slice(at + 1);
			if (Buffer.byteLength(line) > 131072) {
				void close();
				return;
			}
			if (!line.trim()) continue;
			try {
				handle(JSON.parse(line));
			} catch {
				void close();
				return;
			}
		}
		if (Buffer.byteLength(buffer) > 131072) void close();
	});
	const timer = setTimeout(
		() => readyReject(new Error('Terminay MCP relay readiness deadline')),
		10000,
	);
	try {
		await ready;
	} catch (error) {
		await close();
		throw error;
	} finally {
		clearTimeout(timer);
	}
	// The adapter selects this relay's own pair. An image whose adapter cannot
	// is refused here, before the agent is given a server that would fail.
	const environment = {
		TERMINAY_MCP_SOCKET: socket,
		TERMINAY_MCP_TOKEN: secret,
	};
	try {
		await driver.exec(
			`terminay-bot-${botId}`,
			['/usr/local/bin/terminay-bot-mcp', '--terminay-mcp', '--check-runtime'],
			{
				user: 'bot',
				env: environment,
				environmentNames: Object.keys(environment),
				deadlineMs: 10000,
			},
		);
	} catch {
		await close();
		throw new Error(
			'its adapter could not connect. Rebuild the bot image and recreate the environment.',
		);
	}
	return {
		secret,
		environment,
		server: {
			name: 'terminay',
			command: '/usr/local/bin/terminay-bot-mcp',
			args: ['--terminay-mcp'],
			env: Object.entries({ BASH_ENV: '', ...environment }).map(
				([name, value]) => ({ name, value }),
			),
		},
		close,
	};
}
/** A relay that outlives its execution cannot act: the execution capability is revoked first. */
function logRelayCleanupFailure(
	botId: string,
	sessionId: string,
	error: unknown,
): void {
	console.error(
		`[terminay] bot relay cleanup failed: bot=${botId} session=${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
	);
}
