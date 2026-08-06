import {
	ActivityClient,
	AgentStatusClient,
	FileObservationClient,
	FileViewerClient,
	RecordingsClient,
	TerminayClient,
	TerminayClientFacade,
	TerminayGitClient,
	TerminayTerminalClient,
} from '@terminay/client-core';
import type { ServerHello } from '@terminay/protocol';
import type { TerminalPanelClientContextValue } from '../components/TerminalPanel';
import type { LegacyServerFrameCapability } from './legacyServerFrameCapability';
import {
	type ServerMessagePort,
	ServerPortTransport,
	ServerScopedMessagePort,
} from './serverPortTransport';
import { WorkspaceSnapshotStore } from './WorkspaceSnapshotStore';

const DEFAULT_CONNECTION_TIMEOUT_MS = 15_000;
const DEFAULT_SETUP_TIMEOUT_MS = 15_000;
export type RendererBootstrapPhase =
	| 'handshake'
	| 'activity subscription'
	| 'agent-status subscription'
	| 'workspace subscription'
	| 'workspace snapshot';
type RendererBootstrapPhaseState = 'pending' | 'complete' | 'failed';
type RendererBootstrapOptions = {
	readonly connectionTimeoutMs?: number;
	readonly onTransportClosed?: () => void;
	readonly preloadFrameCapability?: LegacyServerFrameCapability;
	readonly setupTimeoutMs?: number;
	readonly onPhaseChange?: (
		phase: RendererBootstrapPhase,
		state: RendererBootstrapPhaseState,
		error?: unknown,
	) => void;
};

export type RendererApplicationClientContext = Readonly<{
	applicationClient: TerminayClient;
	clientId: string;
	dispose: () => Promise<void>;
	serverCapabilities?: readonly string[];
	serverId: string;
}>;

function createRendererServerTransport(
	serverId: string,
	port?: MessagePort,
	preloadFrameCapability?: LegacyServerFrameCapability,
): ServerPortTransport {
	if (port === undefined) {
		if (preloadFrameCapability === undefined) {
			throw new Error('Desktop server-frame capability is unavailable');
		}
		return new ServerPortTransport(
			new PreloadServerMessagePort(serverId, preloadFrameCapability),
		);
	}
	return new ServerPortTransport(
		new ServerScopedMessagePort(port as unknown as ServerMessagePort, serverId),
	);
}

function createRendererClient(transport: ServerPortTransport) {
	const client = new TerminayClient({
		clientId: `desktop-renderer-${crypto.randomUUID()}`,
		clientVersion: 'desktop-local',
		capabilities: ['terminal'],
		transport,
	});
	return client;
}

export async function connectRendererApplicationClient(
	serverId: string,
	port?: MessagePort,
	options: RendererBootstrapOptions = {},
): Promise<RendererApplicationClientContext> {
	const connectionTimeoutMs = boundedTimeout(
		options.connectionTimeoutMs,
		DEFAULT_CONNECTION_TIMEOUT_MS,
		'connection timeout',
	);
	const transport = createRendererServerTransport(
		serverId,
		port,
		options.preloadFrameCapability,
	);
	const client = createRendererClient(transport);
	const controller = new AbortController();
	const timeout = globalThis.setTimeout(() => {
		controller.abort(
			new Error(`server handshake timed out after ${connectionTimeoutMs}ms`),
		);
	}, connectionTimeoutMs);
	let handshakeComplete = false;
	try {
		options.onPhaseChange?.('handshake', 'pending');
		const server = await client.connect(controller.signal);
		handshakeComplete = true;
		options.onPhaseChange?.('handshake', 'complete');
		return {
			applicationClient: client,
			clientId: server.clientId,
			dispose: () => client.close().catch(() => undefined),
			serverCapabilities: server.capabilities,
			serverId: server.serverId,
		};
	} catch (error) {
		if (!handshakeComplete)
			options.onPhaseChange?.('handshake', 'failed', error);
		await client.close().catch(() => undefined);
		throw error;
	} finally {
		globalThis.clearTimeout(timeout);
	}
}

/** Connect the renderer to the one server-scoped port supplied by Desktop. */
export async function connectRendererServerClient(
	serverId: string,
	port?: MessagePort,
	options: RendererBootstrapOptions = {},
): Promise<Omit<TerminalPanelClientContextValue, 'projectId'>> {
	const context = await connectRendererApplicationClient(
		serverId,
		port,
		options,
	);
	const client = context.applicationClient;
	try {
		const server = await client.connect();
		return await createConnectedServerClientContext(client, server, options);
	} catch (error) {
		await client.close().catch(() => undefined);
		throw error;
	}
}

/** Host-neutral feature setup for an already-authenticated TerminayClient.
 * Browser HTTP, Electron MessagePort, and future WebRTC transports share the
 * same server-owned activity, agent, workspace, and disposal semantics. */
export async function createConnectedServerClientContext(
	client: TerminayClient,
	server: ServerHello,
	options: RendererBootstrapOptions = {},
): Promise<Omit<TerminalPanelClientContextValue, 'projectId'>> {
	const setupTimeoutMs = boundedTimeout(
		options.setupTimeoutMs,
		DEFAULT_SETUP_TIMEOUT_MS,
		'setup timeout',
	);
	let workspaceSnapshotStore: WorkspaceSnapshotStore | undefined;
	try {
		const featureTransport = new TerminayClientFacade(client);
		let candidateActivityClient: ActivityClient | undefined;
		candidateActivityClient = new ActivityClient({
			query: featureTransport.query.bind(featureTransport),
			command: featureTransport.command.bind(featureTransport),
			subscribe: (event, listener) =>
				featureTransport.subscribeClientEvents(
					event,
					listener as unknown as (
						message: import('@terminay/client-core').ClientEvent,
					) => void,
					() => {
						// The journal cannot provide a safe generic snapshot. This feature
						// owns its scoped snapshot operation, so converge through it.
						void candidateActivityClient?.refresh().catch(() => undefined);
					},
				),
		});
		const fileViewerClient = new FileViewerClient(featureTransport);
		const fileObservationClient = new FileObservationClient(featureTransport);
		const recordingsClient = new RecordingsClient(featureTransport);
		const gitClient = new TerminayGitClient(featureTransport);
		let candidateAgentStatusClient: AgentStatusClient | undefined;
		candidateAgentStatusClient = new AgentStatusClient([], {
			query: featureTransport.query.bind(featureTransport),
			command: featureTransport.command.bind(featureTransport),
			subscribe: (event, listener) =>
				featureTransport.subscribeEvents(
					event,
					(payload) =>
						listener(payload as unknown as Parameters<typeof listener>[0]),
					() => {
						void candidateAgentStatusClient?.refresh().catch(() => undefined);
					},
				),
		});
		// Activity and agent state are canonical server projections. Do not retain a
		// partially connected renderer for an older compatibility server: doing so
		// makes an absent/stale host-side projection look like a valid workspace.
		// A connected server context either establishes both subscriptions or the
		// connection setup fails visibly and disposes the candidate transport.
		const activityClient = candidateActivityClient;
		const agentStatusClient = candidateAgentStatusClient;
		const store = new WorkspaceSnapshotStore({
			client,
			serverId: server.serverId,
		});
		workspaceSnapshotStore = store;
		if (agentStatusClient !== undefined) {
			store.subscribe((snapshot) => {
				// Workspace deltas can arrive before a host-created terminal is in the
				// workspace projection. Merge them into the known rendered set instead
				// of hiding a still-authorized server agent between those two updates.
				agentStatusClient?.mergeSessionScope(
					Object.values(snapshot.terminalSessions).map((session) => session.id),
				);
			});
		}
		// These projections are independent server resources. Establish them in
		// parallel, while each projection still subscribes before taking its own
		// authoritative initial snapshot.
		const setupResults = await Promise.allSettled([
			trackedPhase(
				options,
				'activity subscription',
				withTimeout(
					candidateActivityClient.subscribe(),
					setupTimeoutMs,
					'activity subscription',
				),
			),
			trackedPhase(
				options,
				'agent-status subscription',
				withTimeout(
					candidateAgentStatusClient.subscribe(),
					setupTimeoutMs,
					'agent-status subscription',
				),
			),
			trackedPhase(
				options,
				'workspace subscription',
				withTimeout(
					store.subscribeToChanges(),
					setupTimeoutMs,
					'workspace subscription',
				),
			).then(() =>
				trackedPhase(
					options,
					'workspace snapshot',
					withTimeout(
						store.loadInitialSnapshot(),
						setupTimeoutMs,
						'workspace snapshot',
					),
				),
			),
		]);
		const failedSetup = setupResults.find(
			(result): result is PromiseRejectedResult => result.status === 'rejected',
		);
		if (failedSetup !== undefined) throw failedSetup.reason;
		let disposed = false;
		const dispose = async () => {
			if (disposed) return;
			disposed = true;
			store.close();
			candidateActivityClient.close();
			candidateAgentStatusClient.close();
			removeStateListener();
			await client.close().catch(() => undefined);
		};
		const removeStateListener = client.onStateChange((change) => {
			(
				window as Window & { __terminayServerClientState?: string }
			).__terminayServerClientState =
				change.current.error === undefined
					? change.current.state
					: `${change.current.state}: ${change.current.error.message}`;
			if (
				change.current.state === 'stale' ||
				change.current.state === 'closed' ||
				change.current.state === 'failed'
			) {
				const unexpectedlyClosed = !disposed;
				void dispose();
				if (unexpectedlyClosed) options.onTransportClosed?.();
			}
		});
		return {
			applicationClient: client,
			client: new TerminayTerminalClient(client),
			activityClient,
			agentStatusClient,
			workspaceSnapshotStore: store,
			dispose,
			fileObservationClient,
			fileViewerClient,
			recordingsClient,
			gitClient,
			serverId: server.serverId,
			clientId: server.clientId,
			serverCapabilities: server.capabilities,
		};
	} catch (error) {
		workspaceSnapshotStore?.close();
		await client.close().catch(() => undefined);
		throw error;
	}
}

async function trackedPhase<T>(
	options: RendererBootstrapOptions,
	phase: RendererBootstrapPhase,
	promise: Promise<T>,
): Promise<T> {
	options.onPhaseChange?.(phase, 'pending');
	try {
		const result = await promise;
		options.onPhaseChange?.(phase, 'complete');
		return result;
	} catch (error) {
		options.onPhaseChange?.(phase, 'failed', error);
		throw error;
	}
}

function boundedTimeout(
	value: number | undefined,
	fallback: number,
	name: string,
): number {
	const timeout = value ?? fallback;
	if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000) {
		throw new RangeError(`${name} must be between 1 and 120000 milliseconds`);
	}
	return timeout;
}

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	operation: string,
): Promise<T> {
	let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_resolve, reject) => {
				timeout = globalThis.setTimeout(
					() =>
						reject(new Error(`${operation} timed out after ${timeoutMs}ms`)),
					timeoutMs,
				);
			}),
		]);
	} finally {
		if (timeout !== undefined) globalThis.clearTimeout(timeout);
	}
}

/** The actual Electron MessagePort stays in preload. Context isolation turns
 * transferred DOM ports into inert objects, so the renderer gets only this
 * fixed-server frame adapter. */
class PreloadServerMessagePort implements ServerMessagePort {
	onmessage: ((event: { readonly data: unknown }) => void) | null = null;
	onmessageerror: (() => void) | null = null;
	private unsubscribe: (() => void) | undefined;

	constructor(
		private readonly serverId: string,
		private readonly frameCapability: LegacyServerFrameCapability,
	) {}

	postMessage(message: unknown): void {
		if (!(message instanceof Uint8Array))
			throw new TypeError('server frame must be bytes');
		const diagnostic = rendererTransportDiagnostic(this.serverId);
		diagnostic.sentFrames += 1;
		diagnostic.lastSentBytes = message.byteLength;
		try {
			this.frameCapability.sendServerFrame(this.serverId, message);
		} catch (error) {
			diagnostic.lastError =
				error instanceof Error ? error.message : String(error);
			throw error;
		}
	}

	start(): void {
		if (this.unsubscribe !== undefined) return;
		const diagnostic = rendererTransportDiagnostic(this.serverId);
		diagnostic.started = true;
		this.unsubscribe = this.frameCapability.onServerFrame(
			this.serverId,
			(frame) => {
				if (frame === null) {
					diagnostic.lastError = 'preload server frame failed validation';
					this.onmessageerror?.();
				} else {
					diagnostic.receivedFrames += 1;
					diagnostic.lastReceivedBytes = frame.byteLength;
					this.onmessage?.({ data: frame });
				}
			},
		);
	}

	close(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
	}
}

type RendererTransportDiagnostic = {
	serverId: string;
	started: boolean;
	sentFrames: number;
	receivedFrames: number;
	lastSentBytes?: number;
	lastReceivedBytes?: number;
	lastError?: string;
};

function rendererTransportDiagnostic(
	serverId: string,
): RendererTransportDiagnostic {
	const target = window as Window & {
		__terminayServerTransportDiagnostics?: RendererTransportDiagnostic;
	};
	if (target.__terminayServerTransportDiagnostics?.serverId === serverId) {
		return target.__terminayServerTransportDiagnostics;
	}
	const diagnostic = {
		serverId,
		started: false,
		sentFrames: 0,
		receivedFrames: 0,
	};
	target.__terminayServerTransportDiagnostics = diagnostic;
	return diagnostic;
}
