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
	readonly signal?: AbortSignal;
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
	serverHello: ServerHello;
	serverCapabilities?: readonly string[];
	serverId: string;
}>;

function createRendererServerTransport(
	serverId: string,
	port: MessagePort,
): ServerPortTransport {
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
	port: MessagePort,
	options: RendererBootstrapOptions = {},
): Promise<RendererApplicationClientContext> {
	const connectionTimeoutMs = boundedTimeout(
		options.connectionTimeoutMs,
		DEFAULT_CONNECTION_TIMEOUT_MS,
		'connection timeout',
	);
	const transport = createRendererServerTransport(serverId, port);
	const client = createRendererClient(transport);
	const controller = new AbortController();
	const abortFromCaller = () =>
		controller.abort(
			options.signal?.reason ?? new Error('server handshake aborted'),
		);
	if (options.signal?.aborted) abortFromCaller();
	else options.signal?.addEventListener('abort', abortFromCaller, { once: true });
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
			serverHello: server,
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
		options.signal?.removeEventListener('abort', abortFromCaller);
	}
}

/** Connect the renderer to the one server-scoped port supplied by Desktop. */
export async function connectRendererServerClient(
	serverId: string,
	port: MessagePort,
	options: RendererBootstrapOptions = {},
): Promise<Omit<TerminalPanelClientContextValue, 'projectId'>> {
	const context = await connectRendererApplicationClient(
		serverId,
		port,
		options,
	);
	return createRendererServerClientContext(context, options);
}

/** Establish the renderer feature projections after a successful application
 * handshake, without reconnecting or replacing its live transport. */
export async function createRendererServerClientContext(
	context: RendererApplicationClientContext,
	options: RendererBootstrapOptions = {},
): Promise<Omit<TerminalPanelClientContextValue, 'projectId'>> {
	return createConnectedServerClientContext(
		context.applicationClient,
		context.serverHello,
		options,
	);
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
		const candidateActivityClient = new ActivityClient({
			query: featureTransport.query.bind(featureTransport),
			command: featureTransport.command.bind(featureTransport),
			subscribe: (event, listener, onResync) =>
				featureTransport.subscribeClientEvents(
					event,
					listener as unknown as (
						message: import('@terminay/client-core').ClientEvent,
					) => void,
					onResync,
				),
		});
		const fileViewerClient = new FileViewerClient(featureTransport);
		const fileObservationClient = new FileObservationClient(featureTransport);
		const recordingsClient = new RecordingsClient(featureTransport);
		const gitClient = new TerminayGitClient(featureTransport);
		const candidateAgentStatusClient = new AgentStatusClient([], {
			query: featureTransport.query.bind(featureTransport),
			command: featureTransport.command.bind(featureTransport),
			subscribe: (event, listener, onResync) =>
				featureTransport.subscribeEvents(
					event,
					(payload) =>
						listener(payload as unknown as Parameters<typeof listener>[0]),
					onResync,
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
					options.signal,
				),
			),
			trackedPhase(
				options,
				'agent-status subscription',
				withTimeout(
					candidateAgentStatusClient.subscribe(),
					setupTimeoutMs,
					'agent-status subscription',
					options.signal,
				),
			),
			trackedPhase(
				options,
				'workspace subscription',
				withTimeout(
					store.subscribeToChanges(),
					setupTimeoutMs,
					'workspace subscription',
					options.signal,
				),
			).then(() =>
				trackedPhase(
					options,
					'workspace snapshot',
					withTimeout(
						store.loadInitialSnapshot(),
						setupTimeoutMs,
						'workspace snapshot',
						options.signal,
					),
				),
			),
		]);
		const failedSetup = setupResults.find(
			(result): result is PromiseRejectedResult => result.status === 'rejected',
		);
		if (failedSetup !== undefined) throw failedSetup.reason;
		let disposePromise: Promise<void> | undefined;
		const dispose = (): Promise<void> => {
			if (disposePromise !== undefined) return disposePromise;
			disposePromise = (async () => {
				store.close();
				candidateActivityClient.close();
				candidateAgentStatusClient.close();
				removeStateListener();
				await client.close().catch(() => undefined);
			})();
			return disposePromise;
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
				const unexpectedlyClosed = disposePromise === undefined;
				const settledDisposal = dispose();
				if (unexpectedlyClosed) {
					void settledDisposal.then(() => options.onTransportClosed?.());
				}
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
	signal?: AbortSignal,
): Promise<T> {
	let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
	let abort: (() => void) | undefined;
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
			new Promise<never>((_resolve, reject) => {
				abort = () =>
					reject(signal?.reason ?? new Error(`${operation} aborted`));
				if (signal?.aborted) abort();
				else signal?.addEventListener('abort', abort, { once: true });
			}),
		]);
	} finally {
		if (timeout !== undefined) globalThis.clearTimeout(timeout);
		if (abort !== undefined) signal?.removeEventListener('abort', abort);
	}
}
