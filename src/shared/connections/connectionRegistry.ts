/**
 * One window, one workspace bundle, many server connections.
 *
 * A window used to hold exactly one `TerminayClient`, one heartbeat, one
 * recovery loop, one `WorkspaceSnapshotStore`, and one agent status store, all
 * as refs in the browser entry. This registry owns that set once per
 * connection instead: a primary connection whose bundle the window runs, and
 * zero or more attached connections.
 *
 * Nothing here merges state across connections. Each entry is a self-contained
 * client for one server, and every id it holds belongs to that server's
 * namespace. Composition — which servers are attached and how their project
 * tabs interleave — is the client's, and lives in `composition.ts`.
 */

import {
	compatibilityToConnectionStatus,
	connectWithCompatibility,
	type ConnectionProfileStore,
	TerminayClient,
	type TerminayClientOptions,
} from '@terminay/client-core';
import {
	CLIENT_SERVER_COMPATIBILITY,
	FEATURE_CAPABILITIES,
	type ByteTransport,
	type ConnectionCompatibility,
	type ServerCompatibilityRequirements,
	type ServerHello,
	type TerminayHostContext,
} from '@terminay/protocol';
import {
	type AgentStatusStore,
	createAgentStatusStore,
} from '../../agentStatusStore.ts';
import type { TerminalPanelClientContextValue } from '../../components/TerminalPanel';
import {
	createRecoveryLoop,
	createSessionHeartbeat,
	logSessionLane,
	RecoveryRetrySchedule,
} from '../../web/sessionConnectAttempt.ts';

/** The feature clients and stores one connection projects for the UI. */
export type WorkspaceConnectionContext = Omit<
	TerminalPanelClientContextValue,
	'projectId'
>;

/** The primary connection supplies the running bundle. Desktop's is always
 * Local; a browser session's is the server the manager opened. */
export type ConnectionRole = 'primary' | 'attached';

export type ConnectionPhase =
	/** No connection yet, and one is being made. */
	| 'connecting'
	/** Connected before; the transport went away and is being remade. */
	| 'reconnecting'
	/** Live, and speaking a protocol this bundle supports. */
	| 'ready'
	/** Not reachable, and not retrying on its own any more. */
	| 'unreachable'
	/** Reached, and refused: the protocol or a required capability does not
	 * match. Its tabs stay in the strip, greyed, and receive no operations. */
	| 'incompatible';

export type WorkspaceConnection = Readonly<{
	profileId: string;
	role: ConnectionRole;
	label: string;
	/** Known once the server has said hello. */
	serverId?: string;
	origin?: string;
	phase: ConnectionPhase;
	error?: string;
	hello?: ServerHello;
	compatibility?: ConnectionCompatibility;
	hostContext?: TerminayHostContext;
	client?: TerminayClient;
	/** Per connection, never shared: a second server's agents are its own. */
	agentStatusStore: AgentStatusStore;
	/** Present only while the connection is usable. An incompatible or
	 * unreachable connection has none, which is what makes its tabs inert. */
	context?: WorkspaceConnectionContext;
	/** Ask for an attempt now rather than waiting out the backoff. */
	retry: () => void;
}>;

export type ConnectionsSnapshot = Readonly<{
	revision: number;
	primary?: WorkspaceConnection;
	/** Primary first, then attached in attach order. */
	connections: readonly WorkspaceConnection[];
	byServerId: ReadonlyMap<string, WorkspaceConnection>;
}>;

export type ConnectionOpenRequest = Readonly<{
	profileId: string;
	role: ConnectionRole;
	/** Desktop recovery has to ask the preload for a fresh byte endpoint. */
	replaceEndpoint: boolean;
	/** The opener calls this when its transport dies underneath us. */
	onTransportClosed: () => void;
}>;

export type ConnectionOpenResult = Readonly<{
	transport: ByteTransport;
	label: string;
	origin?: string;
	hostContext?: TerminayHostContext;
}>;

export type ConnectionRegistryOptions = Readonly<{
	/** Hosts are protocol-blind: they hand back one opaque byte endpoint. */
	open: (request: ConnectionOpenRequest) => Promise<ConnectionOpenResult>;
	createClientId: (role: ConnectionRole) => string;
	clientVersion?: string;
	requirements?: ServerCompatibilityRequirements;
	/** Overridable so a unit test can drive a connection without a server. */
	createClient?: (options: TerminayClientOptions) => TerminayClient;
	/** Kept in step with what this window actually holds: the store is what
	 * the connections control reads, and `attachedProfiles` is the set the
	 * composition is written from. */
	profileStore?: ConnectionProfileStore;
	/** Overridable so a unit test can drive a connection without a server. */
	createContext?: (
		client: TerminayClient,
		hello: ServerHello,
		options: Readonly<{ onTransportClosed: () => void }>,
	) => Promise<WorkspaceConnectionContext>;
	createSchedule?: () => RecoveryRetrySchedule;
	isDocumentHidden?: () => boolean;
	heartbeatIntervalMs?: number;
}>;

type Listener = (snapshot: ConnectionsSnapshot) => void;

class ConnectionEntry {
	readonly agentStatusStore = createAgentStatusStore();
	label: string;
	phase: ConnectionPhase = 'connecting';
	serverId: string | undefined;
	origin: string | undefined;
	error: string | undefined;
	hello: ServerHello | undefined;
	compatibility: ConnectionCompatibility | undefined;
	hostContext: TerminayHostContext | undefined;
	client: TerminayClient | undefined;
	context: WorkspaceConnectionContext | undefined;
	private heartbeat: { stop(): void; probeNow(): void } | undefined;
	private readonly loop: ReturnType<typeof createRecoveryLoop>;
	private disposed = false;
	private view: WorkspaceConnection | undefined;

	readonly profileId: string;
	readonly role: ConnectionRole;
	private readonly options: ConnectionRegistryOptions;
	private readonly changed: () => void;

	constructor(
		profileId: string,
		role: ConnectionRole,
		options: ConnectionRegistryOptions,
		changed: () => void,
	) {
		this.profileId = profileId;
		this.role = role;
		this.options = options;
		this.changed = changed;
		this.label = profileId;
		this.loop = createRecoveryLoop({
			run: (attempt, runOptions) =>
				this.runAttempt(attempt.generation, runOptions.replaceDesktopEndpoint === true),
			recovering: () => this.context !== undefined,
			onAttemptStart: ({ recovering }) => {
				if (recovering) {
					this.phase = 'reconnecting';
				} else {
					this.phase = 'connecting';
					this.clearContext();
				}
				this.changed();
			},
			onAttemptFailed: ({ message, retrying }) => {
				this.clearContext();
				this.error = message;
				this.phase = retrying ? 'reconnecting' : 'unreachable';
				this.changed();
			},
			schedule:
				this.options.createSchedule?.() ??
				new RecoveryRetrySchedule({
					isHidden: () => this.options.isDocumentHidden?.() === true,
				}),
		});
	}

	start(replaceEndpoint = false): void {
		if (this.disposed) return;
		this.loop.start({ replaceDesktopEndpoint: replaceEndpoint });
	}

	resume(): void {
		if (this.disposed) return;
		this.loop.resume();
		this.heartbeat?.probeNow();
	}

	snapshot(): WorkspaceConnection {
		this.view ??= Object.freeze({
			profileId: this.profileId,
			role: this.role,
			label: this.label,
			phase: this.phase,
			agentStatusStore: this.agentStatusStore,
			retry: () => this.start(true),
			...(this.serverId === undefined ? {} : { serverId: this.serverId }),
			...(this.origin === undefined ? {} : { origin: this.origin }),
			...(this.error === undefined ? {} : { error: this.error }),
			...(this.hello === undefined ? {} : { hello: this.hello }),
			...(this.compatibility === undefined
				? {}
				: { compatibility: this.compatibility }),
			...(this.hostContext === undefined
				? {}
				: { hostContext: this.hostContext }),
			...(this.client === undefined ? {} : { client: this.client }),
			...(this.context === undefined ? {} : { context: this.context }),
		});
		return this.view;
	}

	invalidate(): void {
		this.view = undefined;
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		this.loop.dispose();
		this.heartbeat?.stop();
		this.heartbeat = undefined;
		const client = this.client;
		this.client = undefined;
		this.context = undefined;
		await client?.close().catch(() => undefined);
	}

	private clearContext(): void {
		this.context = undefined;
		this.hello = undefined;
	}

	private async runAttempt(
		generation: number,
		replaceEndpoint: boolean,
	): Promise<void> {
		const stale = () => this.disposed || !this.isCurrent(generation);
		await this.client?.close().catch(() => undefined);
		this.heartbeat?.stop();
		this.heartbeat = undefined;

		const opened = await this.options.open({
			profileId: this.profileId,
			role: this.role,
			replaceEndpoint,
			onTransportClosed: () => this.recoverFromClose(generation),
		});
		if (stale()) {
			await opened.transport.close().catch(() => undefined);
			return;
		}
		this.label = opened.label;
		this.origin = opened.origin;
		this.hostContext = opened.hostContext;
		if (
			opened.transport.state === 'closed' ||
			opened.transport.state === 'failed'
		) {
			throw new Error('Session transport closed during connect.');
		}

		const clientOptions: TerminayClientOptions = {
			transport: opened.transport,
			clientId: this.options.createClientId(this.role),
			clientVersion: this.options.clientVersion ?? '0.0.0',
			// The bundle's declared requirements travel in the hello on their own;
			// only the connection mechanics are named here, because liveness and
			// health are not features.
			capabilities: [
				FEATURE_CAPABILITIES.health,
				FEATURE_CAPABILITIES.heartbeat,
			],
		};
		const client = (this.options.createClient ?? defaultCreateClient)(
			clientOptions,
		);
		this.client = client;
		try {
			const { hello, compatibility } = await connectWithCompatibility(
				client,
				this.options.requirements ?? CLIENT_SERVER_COMPATIBILITY,
			);
			if (stale()) {
				await client.close().catch(() => undefined);
				if (this.client === client) this.client = undefined;
				return;
			}
			this.compatibility = compatibility;
			this.serverId = hello?.serverId;
			this.hello = hello;
			this.publishProfileStatus(compatibility);
			// A server this bundle cannot speak to stays attached and inert. It
			// gets no feature clients, so nothing can send it an operation.
			if (compatibility.state === 'incompatible' || hello === undefined) {
				this.phase = 'incompatible';
				this.error = compatibility.state === 'incompatible'
					? compatibility.message
					: 'This server refused the connection.';
				this.context = undefined;
				this.loop.gate.finish({ generation });
				this.changed();
				return;
			}
			const context = await (this.options.createContext ??
				defaultCreateContext)(client, hello, {
				onTransportClosed: () => this.recoverFromClose(generation),
			});
			if (stale()) {
				await client.close().catch(() => undefined);
				if (this.client === client) this.client = undefined;
				return;
			}
			this.loop.gate.finish({ generation });
			// Liveness is proven by asking, not by watching traffic: a WebRTC
			// generation can stop delivering while every lane still reports open.
			const heartbeat = createSessionHeartbeat({
				ping: (signal) =>
					client.query('connection.ping', { sentAt: Date.now() }, { signal }),
				onLost: (snapshot) => {
					logSessionLane('connection-heartbeat-lost', snapshot);
					this.error = 'Connection lost. Reconnecting…';
					this.changed();
					this.recoverFromClose(generation);
				},
				...(this.options.heartbeatIntervalMs === undefined
					? {}
					: { intervalMs: this.options.heartbeatIntervalMs }),
			});
			this.heartbeat = heartbeat;
			heartbeat.start();
			this.context = context;
			this.phase = 'ready';
			this.error = undefined;
			this.changed();
		} catch (cause) {
			await client.close().catch(() => undefined);
			if (this.client === client) this.client = undefined;
			throw cause;
		}
	}

	/** A degraded server is still usable and stays connected; only one this
	 * bundle cannot talk to at all is recorded incompatible. */
	private publishProfileStatus(
		compatibility: Parameters<typeof compatibilityToConnectionStatus>[0],
	): void {
		const store = this.options.profileStore;
		const profile = store?.get(this.profileId);
		if (store === undefined || profile === undefined) return;
		store.remember({
			...profile,
			status: compatibilityToConnectionStatus(compatibility),
		});
	}

	private isCurrent(generation: number): boolean {
		return this.loop.gate.currentGeneration === generation;
	}

	private recoverFromClose(generation: number): void {
		if (this.disposed) return;
		if (!this.loop.gate.shouldRecoverFromClose({ generation })) return;
		this.start(true);
	}
}

function defaultCreateClient(options: TerminayClientOptions): TerminayClient {
	return new TerminayClient(options);
}

/** The feature projections are loaded on demand so this module stays a plain
 * lifecycle: a test can drive a whole connection without the renderer's
 * feature tree, and the tree is not pulled in until a server actually says
 * hello. */
async function defaultCreateContext(
	client: TerminayClient,
	hello: ServerHello,
	options: Readonly<{ onTransportClosed: () => void }>,
): Promise<WorkspaceConnectionContext> {
	const { createConnectedServerClientContext } = await import(
		'../rendererServerClient.js'
	);
	return createConnectedServerClientContext(client, hello, options);
}

const EMPTY_SNAPSHOT: ConnectionsSnapshot = Object.freeze({
	revision: 0,
	connections: Object.freeze([]),
	byServerId: new Map(),
});

/**
 * The set of connections one window holds.
 *
 * Order is attach order with the primary first, and it is the order the tab
 * strip groups by when the composition has nothing to say about a tab.
 */
export class ConnectionRegistry {
	private readonly entries = new Map<string, ConnectionEntry>();
	private readonly listeners = new Set<Listener>();
	private primaryProfileId: string | undefined;
	private revision = 0;
	private current: ConnectionsSnapshot = EMPTY_SNAPSHOT;
	private disposed = false;

	private readonly options: ConnectionRegistryOptions;

	constructor(options: ConnectionRegistryOptions) {
		this.options = options;
	}

	get snapshot(): ConnectionsSnapshot {
		return this.current;
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** The connection whose bundle this window runs. Created exactly once per
	 * life of the registry: `dispose()` ends one life, and the next
	 * `startPrimary` — a StrictMode remount, or returning from the manager —
	 * starts another rather than crashing the shell. */
	startPrimary(profileId: string): WorkspaceConnection {
		if (this.primaryProfileId !== undefined)
			throw new Error('This window already has a primary connection.');
		this.disposed = false;
		this.primaryProfileId = profileId;
		// The primary is the selected profile, and selecting attaches it: a
		// workspace always runs against one server it chose.
		if (this.options.profileStore?.get(profileId) !== undefined)
			this.options.profileStore.select(profileId);
		const entry = this.createEntry(profileId, 'primary');
		entry.start();
		this.publish();
		return entry.snapshot();
	}

	/** Attach a remembered profile. Attaching twice is a no-op, not an error:
	 * the connections control and a restored composition can both ask. */
	attach(profileId: string): WorkspaceConnection | undefined {
		// A disposed registry owns no connections: attaching to one would create
		// an entry nothing will ever tear down.
		if (this.disposed) return undefined;
		const existing = this.entries.get(profileId);
		if (existing !== undefined) return existing.snapshot();
		if (
			this.options.profileStore?.get(profileId) !== undefined &&
			!this.options.profileStore.isAttached(profileId)
		)
			this.options.profileStore.attach(profileId);
		const entry = this.createEntry(profileId, 'attached');
		entry.start();
		this.publish();
		return entry.snapshot();
	}

	/** Detaching closes this window's connection and nothing on the server. */
	async detach(profileId: string): Promise<void> {
		if (profileId === this.primaryProfileId)
			throw new Error('The primary connection cannot be detached.');
		const entry = this.entries.get(profileId);
		if (entry === undefined) return;
		// Detaching leaves the profile remembered and closes nothing on the
		// server: its terminals keep running and re-attaching finds them.
		if (this.options.profileStore?.isAttached(profileId) === true)
			this.options.profileStore.detach(profileId);
		this.entries.delete(profileId);
		this.publish();
		await entry.dispose();
	}

	get(profileId: string): WorkspaceConnection | undefined {
		return this.entries.get(profileId)?.snapshot();
	}

	forServer(serverId: string): WorkspaceConnection | undefined {
		return this.current.byServerId.get(serverId);
	}

	/** The document came back to the foreground: probe every connection now
	 * rather than waiting out each one's interval. */
	resume(): void {
		for (const entry of this.entries.values()) entry.resume();
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		// The primary slot is freed with everything else, so a remount can start
		// this registry over instead of throwing.
		this.primaryProfileId = undefined;
		const entries = [...this.entries.values()];
		this.entries.clear();
		this.publish();
		await Promise.all(entries.map((entry) => entry.dispose()));
	}

	private createEntry(
		profileId: string,
		role: ConnectionRole,
	): ConnectionEntry {
		const entry = new ConnectionEntry(profileId, role, this.options, () => {
			entry.invalidate();
			this.publish();
		});
		this.entries.set(profileId, entry);
		return entry;
	}

	private publish(): void {
		if (this.disposed && this.entries.size > 0) return;
		this.revision += 1;
		const ordered: WorkspaceConnection[] = [];
		const byServerId = new Map<string, WorkspaceConnection>();
		for (const entry of this.entries.values()) {
			const view = entry.snapshot();
			if (view.role === 'primary') ordered.unshift(view);
			else ordered.push(view);
			// Two profiles can point at one server. First attached wins the key,
			// so a duplicate never displaces the connection the tabs already use.
			if (view.serverId !== undefined && !byServerId.has(view.serverId))
				byServerId.set(view.serverId, view);
		}
		const primary = ordered.find((entry) => entry.role === 'primary');
		this.current = Object.freeze({
			revision: this.revision,
			connections: Object.freeze(ordered),
			byServerId,
			...(primary === undefined ? {} : { primary }),
		});
		for (const listener of [...this.listeners]) listener(this.current);
	}
}
