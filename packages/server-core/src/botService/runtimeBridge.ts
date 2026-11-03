import { randomBytes, timingSafeEqual } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import type { JsonValue } from '@terminay/protocol';
import type { BotCredentialLease } from './acp.js';
import type { EngineDriver } from './engine.js';
import { BOT_RUNTIME_TOOLS, type BotExecutionRuntime } from './runtime.js';
import { BotTokenRedactor } from './tokens.js';
import { BotError, object } from './store.js';

export interface BotRuntimeBridge {
	readonly servers: readonly JsonValue[];
	readonly environment: Readonly<Record<string, string>>;
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
		const line = JSON.stringify({ connection, message }) + '\n';
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
					{ user: 'root', deadlineMs: 20000 },
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
						if (source === 'stderr')
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
	const environment = {
		BASH_ENV: '/usr/local/bin/terminay-shell-env',
		TERMINAY_RUNTIME_SOCKET: socket,
		TERMINAY_RUNTIME_TOKEN: token,
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
		],
		environment,
		close,
		wrapCredential: (credential) => ({
			...credential,
			redact: (value) =>
				credential.redact(value).split(token).join('[redacted]'),
			stream: () => {
				const first = credential.stream(),
					second = new BotTokenRedactor([token]),
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
