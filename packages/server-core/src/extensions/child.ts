import { pathToFileURL } from 'node:url';
import { EXTENSION_API_VERSION } from '@terminay/extension-api';
import { parseExtensionLanguageRequest } from './languageProtocol.js';
import {
	LanguageSessionRuntime,
	type LanguageServerProviderLike,
} from './languageSessionRuntime.js';
import {
	type ChildFrame,
	frameByteLength,
	type HostFrame,
	isHostFrame,
	jsonIpcValue,
} from './protocol.js';

const MAX_MESSAGE_BYTES = 256 * 1024;
/** How long a dying child waits for its fatal report to reach the host. */
const FATAL_REPORT_FLUSH_MS = 100;
const invocations = new Map<string, AbortController>();
const brokerCalls = new Map<
	string,
	{ resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
let deactivate: (() => unknown | Promise<unknown>) | undefined;
let callbacks: Record<
	string,
	(
		input: unknown,
		context: { signal: AbortSignal },
	) => unknown | Promise<unknown>
> = {};
/** One registered session source and, while it runs, its publisher state. */
interface ChildSessionSource {
	readonly runtime: { start(start: unknown): unknown };
	controller?: AbortController;
	enabled: readonly string[];
	readonly listeners: Set<(enabled: readonly string[]) => void>;
	/** What the host holds once every sent batch applies. */
	live: Map<string, unknown>;
	/** Calls not yet sent, coalesced by session id. */
	pending: {
		reset?: Map<string, unknown>;
		upserts: Map<string, unknown>;
		removals: Set<string>;
	};
	flushing: boolean;
}
const sessionSources = new Map<string, ChildSessionSource>();
const mcpTargets = new Map<string, Record<string, unknown>>();
/** Frames stay well under the host's limit so one session never overflows. */
const PUBLICATION_BUDGET_BYTES = 192 * 1024;
let subscriptions: Array<{ dispose(): unknown | Promise<unknown> }> = [];
let sequence = 0;
/** Every language server this extension runs, and their sessions. Created on
 * activation so a child that contributes none carries no runtime at all. */
let languageRuntime: LanguageSessionRuntime | undefined;

process.on('message', (message: unknown) => {
	void receive(message);
});
process.on('disconnect', () => process.exit(0));
process.on('uncaughtException', (error) => reportFatal(error, 70));
process.on('unhandledRejection', (reason) => reportFatal(reason, 71));

/**
 * Report the error that is ending this child, then exit with the code that
 * names how it ended.
 *
 * Registering these handlers suppresses Node's own stack print, and a packaged
 * child's stderr goes nowhere a person can read, so without this frame the host
 * sees only an exit code. The send is best effort by design: the exit must not
 * depend on the channel still being open.
 */
function reportFatal(cause: unknown, exitCode: number): void {
	let exited = false;
	const exit = (): void => {
		if (exited) return;
		exited = true;
		process.exit(exitCode);
	};
	try {
		const error =
			cause instanceof Error
				? cause
				: new Error(typeof cause === 'string' ? cause : String(cause));
		sequence += 1;
		const report = (stack: string | undefined): ChildFrame => ({
			protocolVersion: 1,
			kind: 'fatal',
			id: `fatal-${sequence}`,
			payload: {
				name: error.name,
				message: error.message,
				...(stack === undefined ? {} : { stack }),
				exitCode,
			},
		});
		// The error text is reported as it stands. Only a stack past the frame
		// limit is dropped, because a frame the host must reject carries less
		// than the same error with no stack at all.
		const stack = typeof error.stack === 'string' ? error.stack : undefined;
		const frame =
			frameByteLength(report(stack)) > MAX_MESSAGE_BYTES
				? report(undefined)
				: report(stack);
		if (typeof process.send !== 'function' || !process.connected) {
			exit();
			return;
		}
		// `process.send` can queue rather than flush, and `process.exit` would
		// discard a queued frame. Exit once it is written, and on a short
		// deadline so a wedged channel cannot keep a dying child alive.
		process.send(frame, exit);
		setTimeout(exit, FATAL_REPORT_FLUSH_MS);
	} catch {
		/* a failed report must never replace the exit code it describes */
		exit();
	}
}

async function receive(message: unknown): Promise<void> {
	if (!isHostFrame(message) || frameByteLength(message) > MAX_MESSAGE_BYTES)
		process.exit(72);
	if (message.kind === 'cancel') {
		invocations.get(message.id)?.abort();
		return;
	}
	if (message.kind === 'broker.result') {
		const pending = brokerCalls.get(message.id);
		if (pending === undefined) return;
		brokerCalls.delete(message.id);
		const payload = object(message.payload);
		payload?.ok === true
			? pending.resolve(payload.value)
			: pending.reject(
					new Error(
						typeof payload?.failure === 'string'
							? payload.failure
							: 'broker request failed',
					),
				);
		return;
	}
	if (message.kind === 'agent.source.ack') {
		const pending = brokerCalls.get(message.id);
		if (pending === undefined) return;
		brokerCalls.delete(message.id);
		pending.resolve(object(message.payload) ?? { ok: false });
		return;
	}
	if (message.kind === 'activate') {
		await activateExtension(message);
		return;
	}
	if (message.kind === 'language.request') {
		await invokeLanguage(message);
		return;
	}
	if (message.kind === 'deactivate') {
		for (const controller of invocations.values()) controller.abort();
		await languageRuntime?.stopAll().catch(() => undefined);
		stopAllSources();
		try {
			try {
				await deactivate?.();
			} finally {
				await disposeSubscriptions();
			}
			send({ protocolVersion: 1, kind: 'deactivated', id: message.id });
		} catch (error) {
			failure(message.id, error);
		}
		return;
	}
	if (message.kind === 'invoke') await invoke(message);
	if (message.kind === 'agent.source.start') await startSource(message);
	if (message.kind === 'agent.source.stop') stopSource(message);
	if (message.kind === 'agent.source.harnesses') setSourceHarnesses(message);
	if (message.kind === 'mcp.target.invoke') await invokeMcpTarget(message);
}

async function activateExtension(frame: HostFrame): Promise<void> {
	try {
		const payload = object(frame.payload);
		if (
			typeof payload?.entrypoint !== 'string' ||
			typeof payload.extensionId !== 'string'
		)
			throw new Error('invalid activation payload');
		const imported = await import(pathToFileURL(payload.entrypoint).href);
		const extension = object(imported.default);
		const activate =
			extension?.activate ?? imported.activate ?? imported.default;
		if (typeof activate !== 'function')
			throw new Error('extension must export activate(context)');
		const agentSessionSources: string[] = [];
		const mcpInstallTargets: string[] = [];
		stopAllSources();
		sessionSources.clear();
		mcpTargets.clear();
		subscriptions = [];
		const declaredLanguageServers = new Set(
			Array.isArray(payload.languageServers)
				? payload.languageServers
						.map((entry) => object(entry)?.id)
						.filter((id): id is string => typeof id === 'string')
				: [],
		);
		const languageServers: string[] = [];
		languageRuntime = new LanguageSessionRuntime({
			onDiagnostics: (notification) => {
				send({
					protocolVersion: 1,
					kind: 'language.diagnostics',
					id: `language-diagnostics:${++sequence}`,
					payload: notification as unknown as Record<string, unknown>,
				});
			},
			onSessionExit: (exit) => {
				send({
					protocolVersion: 1,
					kind: 'language.session.exited',
					id: `language-exit:${++sequence}`,
					payload: exit as unknown as Record<string, unknown>,
				});
			},
		});
		const declaredIds = (value: unknown) =>
			new Set(
				Array.isArray(value)
					? value
							.map((entry) => object(entry)?.id)
							.filter((id): id is string => typeof id === 'string')
					: [],
			);
		const declaredSources = declaredIds(payload.agentSessionSources);
		const declaredTargets = declaredIds(payload.mcpInstallTargets);
		const result = await activate(
			Object.freeze({
				extensionId: payload.extensionId,
				apiVersion:
					typeof payload.apiVersion === 'string'
						? payload.apiVersion
						: EXTENSION_API_VERSION,
				paths: Object.freeze({
					configuration: payload.configDirectory,
					data: payload.dataDirectory,
					cache: payload.cacheDirectory,
				}),
				agents: Object.freeze({
					registerSessionSource(sourceId: string, runtime: unknown) {
						const value = object(runtime);
						if (
							typeof sourceId !== 'string' ||
							!declaredSources.has(sourceId) ||
							sessionSources.has(sourceId) ||
							value === undefined ||
							typeof value.start !== 'function'
						)
							throw new Error(
								'session source registration is undeclared or invalid',
							);
						sessionSources.set(sourceId, {
							runtime: value as ChildSessionSource['runtime'],
							enabled: [],
							listeners: new Set(),
							live: new Map(),
							pending: { upserts: new Map(), removals: new Set() },
							flushing: false,
						});
						agentSessionSources.push(sourceId);
						let disposed = false;
						return Object.freeze({
							sourceId,
							dispose() {
								if (disposed) return;
								disposed = true;
								sessionSources.get(sourceId)?.controller?.abort();
								sessionSources.delete(sourceId);
								send({
									protocolVersion: 1,
									kind: 'agent.source.disposed',
									id: `agent-dispose:${++sequence}`,
									payload: { sourceId },
								});
							},
						});
					},
				}),
				mcp: Object.freeze({
					registerInstallTarget(targetId: string, runtime: unknown) {
						const value = object(runtime);
						if (
							typeof targetId !== 'string' ||
							!declaredTargets.has(targetId) ||
							mcpTargets.has(targetId) ||
							value === undefined ||
							typeof value.status !== 'function' ||
							typeof value.install !== 'function' ||
							typeof value.uninstall !== 'function'
						)
							throw new Error(
								'MCP install target registration is undeclared or invalid',
							);
						mcpTargets.set(targetId, value);
						mcpInstallTargets.push(targetId);
						let disposed = false;
						return Object.freeze({
							targetId,
							dispose() {
								if (disposed) return;
								disposed = true;
								mcpTargets.delete(targetId);
								send({
									protocolVersion: 1,
									kind: 'mcp.target.disposed',
									id: `mcp-dispose:${++sequence}`,
									payload: { targetId },
								});
							},
						});
					},
				}),
				registerLanguageServerProvider(registration: unknown) {
					const value = object(registration);
					const id = typeof value?.id === 'string' ? value.id : '';
					const runtime = object(value?.runtime);
					if (
						!declaredLanguageServers.has(id) ||
						languageRuntime === undefined ||
						languageRuntime.has(id) ||
						runtime === undefined ||
						typeof runtime.launch !== 'function'
					)
						throw new Error(
							'language server registration is undeclared or invalid',
						);
					languageRuntime.register(
						id,
						runtime as unknown as LanguageServerProviderLike,
					);
					languageServers.push(id);
					let disposed = false;
					return Object.freeze({
						id,
						dispose() {
							if (disposed) return;
							disposed = true;
							languageRuntime?.unregister(id);
						},
					});
				},
				subscriptions: Object.freeze({
					add(subscription: unknown) {
						const value = object(subscription);
						if (value === undefined || typeof value.dispose !== 'function')
							throw new Error('extension subscription must be disposable');
						subscriptions.push(
							value as { dispose(): unknown | Promise<unknown> },
						);
						return subscription;
					},
				}),
				// Private broker capabilities are host-injected. They are deliberately
				// not application protocol handlers or raw transports.
				directories: Object.freeze({
					config: payload.configDirectory,
					data: payload.dataDirectory,
					cache: payload.cacheDirectory,
				}),
				permissions: Object.freeze(
					Array.isArray(payload.permissions) ? [...payload.permissions] : [],
				),
				broker: Object.freeze({ request: brokerRequest }),
			}),
		);
		const definition = object(result) ?? {};
		const methods = object(definition.methods) ?? {};
		callbacks = {};
		for (const [name, callback] of Object.entries(methods)) {
			if (
				typeof callback !== 'function' ||
				name.length === 0 ||
				name.length > 200
			)
				throw new Error('extension returned an invalid method definition');
			callbacks[name] = callback as (typeof callbacks)[string];
		}
		if (
			definition.deactivate !== undefined &&
			typeof definition.deactivate !== 'function'
		)
			throw new Error('extension returned an invalid deactivate callback');
		deactivate = (extension?.deactivate ??
			definition.deactivate) as typeof deactivate;
		send({
			protocolVersion: 1,
			kind: 'ready',
			id: frame.id,
			payload: {
				methods: Object.keys(callbacks).sort(),
				agentSessionSources,
				mcpInstallTargets,
				languageServers,
			},
		});
	} catch (error) {
		failure(frame.id, error);
	}
}

async function disposeSubscriptions(): Promise<void> {
	const owned = subscriptions;
	subscriptions = [];
	for (const subscription of owned.reverse()) await subscription.dispose();
}

function enabledHarnessesOf(value: unknown): readonly string[] {
	const list = object(value)?.enabledHarnesses;
	return Object.freeze(
		Array.isArray(list)
			? list.filter((id): id is string => typeof id === 'string')
			: [],
	);
}

function sourceFor(frame: HostFrame): [string, ChildSessionSource] {
	const sourceId = object(frame.payload)?.sourceId;
	const source =
		typeof sourceId === 'string' ? sessionSources.get(sourceId) : undefined;
	if (source === undefined || typeof sourceId !== 'string')
		throw new Error('session source is not registered');
	return [sourceId, source];
}

/**
 * Start one source. Its publisher coalesces calls per session and sends one
 * batch at a time, so a burst of changes costs one frame, not one per change,
 * and the host is never sent more than it has acknowledged.
 */
async function startSource(frame: HostFrame): Promise<void> {
	try {
		const [sourceId, source] = sourceFor(frame);
		source.controller?.abort();
		const controller = new AbortController();
		source.controller = controller;
		source.enabled = enabledHarnessesOf(frame.payload);
		source.listeners.clear();
		source.live = new Map();
		source.pending = { upserts: new Map(), removals: new Set() };
		const active = () =>
			!controller.signal.aborted && source.controller === controller;
		const publisher = Object.freeze({
			reset(sessions: readonly unknown[]) {
				if (!active() || !Array.isArray(sessions)) return;
				const reset = new Map(
					sessions.map((session) => [sessionId(session), session]),
				);
				source.live = new Map(reset);
				source.pending = { reset, upserts: new Map(), removals: new Set() };
				scheduleFlush(sourceId, source);
			},
			upsert(session: unknown) {
				if (!active()) return;
				const id = sessionId(session);
				source.live.set(id, session);
				if (source.pending.reset !== undefined)
					source.pending.reset.set(id, session);
				else {
					source.pending.removals.delete(id);
					source.pending.upserts.set(id, session);
				}
				scheduleFlush(sourceId, source);
			},
			remove(id: unknown) {
				if (!active() || typeof id !== 'string') return;
				source.live.delete(id);
				if (source.pending.reset !== undefined) source.pending.reset.delete(id);
				else {
					source.pending.upserts.delete(id);
					source.pending.removals.add(id);
				}
				scheduleFlush(sourceId, source);
			},
			diagnostic(diagnostic: unknown) {
				if (!active()) return;
				send({
					protocolVersion: 1,
					kind: 'agent.source.diagnostic',
					id: `agent-diagnostic:${++sequence}`,
					payload: { sourceId, diagnostic } as Record<string, unknown>,
				});
			},
		});
		await source.runtime.start(
			Object.freeze({
				enabledHarnesses: source.enabled,
				publisher,
				signal: controller.signal,
				onEnabledHarnessesChanged(
					listener: (enabled: readonly string[]) => void,
				) {
					if (typeof listener !== 'function')
						throw new TypeError('harness listener must be a function');
					source.listeners.add(listener);
					return Object.freeze({
						dispose() {
							source.listeners.delete(listener);
						},
					});
				},
			}),
		);
		send({ protocolVersion: 1, kind: 'result', id: frame.id });
	} catch (error) {
		failure(frame.id, error);
	}
}

function stopSource(frame: HostFrame): void {
	try {
		const [, source] = sourceFor(frame);
		source.controller?.abort();
		source.controller = undefined;
		source.listeners.clear();
		send({ protocolVersion: 1, kind: 'result', id: frame.id });
	} catch (error) {
		failure(frame.id, error);
	}
}

function stopAllSources(): void {
	for (const source of sessionSources.values()) {
		source.controller?.abort();
		source.controller = undefined;
		source.listeners.clear();
	}
}

function setSourceHarnesses(frame: HostFrame): void {
	try {
		const [, source] = sourceFor(frame);
		source.enabled = enabledHarnessesOf(frame.payload);
		for (const listener of [...source.listeners]) listener(source.enabled);
		send({ protocolVersion: 1, kind: 'result', id: frame.id });
	} catch (error) {
		failure(frame.id, error);
	}
}

function sessionId(session: unknown): string {
	const id = object(session)?.id;
	return typeof id === 'string' ? id : `invalid:${++sequence}`;
}

function scheduleFlush(sourceId: string, source: ChildSessionSource): void {
	if (source.flushing) return;
	source.flushing = true;
	setImmediate(() => {
		void flushSource(sourceId, source).finally(() => {
			source.flushing = false;
			if (hasPending(source) && source.controller !== undefined)
				scheduleFlush(sourceId, source);
		});
	});
}

function hasPending(source: ChildSessionSource): boolean {
	return (
		source.pending.reset !== undefined ||
		source.pending.upserts.size > 0 ||
		source.pending.removals.size > 0
	);
}

async function flushSource(
	sourceId: string,
	source: ChildSessionSource,
): Promise<void> {
	while (hasPending(source) && source.controller !== undefined) {
		const controller = source.controller;
		const batch = source.pending;
		source.pending = { upserts: new Map(), removals: new Set() };
		for (const payload of publicationFrames(sourceId, batch)) {
			const ack = await sessionRequest(payload);
			if (source.controller !== controller) return;
			if (ack.resend === true) {
				// The host dropped what it had queued: send the whole live set.
				source.pending = {
					reset: new Map(source.live),
					upserts: new Map(),
					removals: new Set(),
				};
				break;
			}
		}
	}
}

/** Split one coalesced batch into frames under the IPC budget. A reset that
 * does not fit continues as upserts; removals ride on the last frame. */
function publicationFrames(
	sourceId: string,
	batch: ChildSessionSource['pending'],
): Record<string, unknown>[] {
	const frames: Record<string, unknown>[] = [];
	let current: unknown[] = [];
	let bytes = 0;
	let resetOpen = batch.reset !== undefined;
	const close = () => {
		frames.push({
			sourceId,
			...(resetOpen ? { reset: current } : { upserts: current }),
		});
		resetOpen = false;
		current = [];
		bytes = 0;
	};
	for (const session of [
		...(batch.reset?.values() ?? []),
		...batch.upserts.values(),
	]) {
		const size = frameByteLength(jsonIpcValue(session));
		if (current.length > 0 && bytes + size > PUBLICATION_BUDGET_BYTES) close();
		current.push(session);
		bytes += size;
	}
	if (current.length > 0 || resetOpen || batch.removals.size > 0) close();
	const last = frames[frames.length - 1]!;
	if (batch.removals.size > 0) last.removals = [...batch.removals];
	return frames;
}

function sessionRequest(
	payload: Record<string, unknown>,
): Promise<{ ok?: unknown; resend?: unknown }> {
	const id = `agent:${++sequence}`;
	return new Promise((resolve) => {
		brokerCalls.set(id, {
			resolve: (value) => resolve(object(value) ?? {}),
			reject: () => resolve({ ok: false }),
		});
		if (
			!send({ protocolVersion: 1, kind: 'agent.source.publish', id, payload })
		) {
			brokerCalls.delete(id);
			resolve({ ok: false });
		}
	});
}

async function invokeMcpTarget(frame: HostFrame): Promise<void> {
	const payload = object(frame.payload);
	const target =
		typeof payload?.targetId === 'string'
			? mcpTargets.get(payload.targetId)
			: undefined;
	const operation = payload?.operation;
	const method =
		operation === 'status' ||
		operation === 'install' ||
		operation === 'uninstall'
			? target?.[operation]
			: undefined;
	if (typeof method !== 'function') {
		failure(frame.id, new Error('MCP install target is not registered'));
		return;
	}
	const controller = new AbortController();
	invocations.set(frame.id, controller);
	try {
		const result = await (
			method as (request: unknown) => Promise<unknown>
		).call(target, { server: payload?.server, signal: controller.signal });
		if (
			!send({
				protocolVersion: 1,
				kind: 'result',
				id: frame.id,
				payload: result,
			})
		)
			exitUndeliverable();
	} catch (error) {
		failure(frame.id, error);
	} finally {
		invocations.delete(frame.id);
	}
}

/**
 * One private language invocation. It shares the invocation map with ordinary
 * extension methods so the host's existing `cancel` frame aborts a superseded
 * completion exactly as it aborts any other in-flight work.
 */
async function invokeLanguage(frame: HostFrame): Promise<void> {
	const request = parseExtensionLanguageRequest(frame.payload);
	if (request === undefined || languageRuntime === undefined) {
		failure(frame.id, new Error('language request is invalid'));
		return;
	}
	const controller = new AbortController();
	invocations.set(frame.id, controller);
	try {
		const result = await languageRuntime.handle(
			request.method,
			request.input,
			controller.signal,
		);
		if (
			!send({
				protocolVersion: 1,
				kind: 'result',
				id: frame.id,
				payload: result,
			})
		)
			exitUndeliverable();
	} catch (error) {
		failure(frame.id, error);
	} finally {
		invocations.delete(frame.id);
	}
}

async function invoke(frame: HostFrame): Promise<void> {
	const payload = object(frame.payload);
	const method =
		typeof payload?.method === 'string' ? callbacks[payload.method] : undefined;
	if (method === undefined) {
		failure(frame.id, new Error('unknown extension method'));
		return;
	}
	const controller = new AbortController();
	invocations.set(frame.id, controller);
	try {
		const result = await method(payload?.input, { signal: controller.signal });
		if (
			!send({
				protocolVersion: 1,
				kind: 'result',
				id: frame.id,
				payload: result,
			})
		)
			exitUndeliverable();
	} catch (error) {
		failure(frame.id, error);
	} finally {
		invocations.delete(frame.id);
	}
}

function brokerRequest(
	operation: 'log' | 'secret.resolve',
	payload: unknown,
	signal?: AbortSignal,
): Promise<unknown> {
	if (operation !== 'log' && operation !== 'secret.resolve')
		return Promise.reject(new Error('unsupported broker operation'));
	const id = `broker:${++sequence}`;
	return new Promise((resolve, reject) => {
		const abort = () => {
			brokerCalls.delete(id);
			send({ protocolVersion: 1, kind: 'broker.cancel', id });
			reject(new Error('broker request cancelled'));
		};
		if (signal?.aborted) {
			reject(new Error('broker request cancelled'));
			return;
		}
		signal?.addEventListener('abort', abort, { once: true });
		brokerCalls.set(id, {
			resolve: (value) => {
				signal?.removeEventListener('abort', abort);
				resolve(value);
			},
			reject: (error) => {
				signal?.removeEventListener('abort', abort);
				reject(error);
			},
		});
		if (
			!send({
				protocolVersion: 1,
				kind: 'broker.request',
				id,
				payload: { operation, payload },
			})
		) {
			brokerCalls.delete(id);
			reject(new Error(`broker IPC send failed: ${lastSendFailure}`));
		}
	});
}

/**
 * End a child whose reply to the host could not be written. The host is owed
 * the reply, so carrying on would leave it waiting; the fatal report says
 * which frame was refused and why, where an exit code alone said nothing.
 */
function exitUndeliverable(): void {
	reportFatal(new Error(`host IPC send failed: ${lastSendFailure}`), 73);
}

/** Why the last refused `send` was refused, so the error it becomes says so. */
let lastSendFailure = 'not sent';

function send(frame: ChildFrame): boolean {
	const safe = jsonIpcValue(frame);
	const refuse = (reason: string): false => {
		lastSendFailure = `${frame.kind} frame ${reason}`;
		return false;
	};
	if (safe === undefined) return refuse('is not JSON-serializable');
	const bytes = frameByteLength(safe);
	if (bytes > MAX_MESSAGE_BYTES)
		return refuse(`is ${bytes} bytes, over the ${MAX_MESSAGE_BYTES} byte limit`);
	if (typeof process.send !== 'function' || !process.connected)
		return refuse('has no connected host channel');
	try {
		// `process.send` returns false when the channel's write queue is long, not
		// when the frame was lost: it is queued and still delivered. Treating that
		// as a failure killed an agent child whenever it published a burst of
		// lifecycle events faster than the host drained them. A write the
		// operating system later refuses reaches the callback, and the
		// `disconnect` handler ends this child when the host has gone.
		process.send(safe as ChildFrame, undefined, undefined, () => undefined);
		return true;
	} catch (error) {
		return refuse(
			`was rejected by process.send: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function failure(id: string, error: unknown): void {
	send({
		protocolVersion: 1,
		kind: 'failure',
		id,
		payload: {
			message:
				error instanceof Error
					? error.message.slice(0, 1_000)
					: 'extension operation failed',
		},
	});
}
function object(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
