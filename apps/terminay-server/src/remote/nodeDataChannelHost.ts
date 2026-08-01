import type {
	HeadlessWebRtcRuntime,
	HeadlessWebRtcRuntimeContext,
	RemoteAuthProof,
	RemoteConnectionManager,
	RemoteHeadlessSession,
	RemoteHeadlessSessionSnapshot,
	RemoteRateLimiterOptions,
} from '@terminay/server-core';
import {
	RemoteHeadlessWebRtcFactory,
	RemoteRateLimiter,
} from '@terminay/server-core';
import {
	createNodeDataChannelOpenChannels,
	type NodeDataChannelSignaling,
} from './nodeDataChannelPeer.js';
import {
	createNodeDataChannelRuntimeAdapter,
	type NodeDataChannelLike,
	type NodeDataChannelRuntimeModule,
} from './nodeDataChannelRuntime.js';

export type NodeDataChannelHostEvent =
	| { readonly type: 'connect-started'; readonly deviceId: string }
	| {
			readonly type: 'connected';
			readonly deviceId: string;
			readonly peerId: string;
	  }
	| { readonly type: 'connect-failed'; readonly deviceId: string }
	| {
			readonly type: 'session-closed';
			readonly peerId: string;
			readonly deviceId: string;
	  }
	| { readonly type: 'shutdown' };

export interface NodeDataChannelHeadlessHostOptions {
	/** Selected runtime identity. The host lifecycle and authenticated
	 * signaling policy are implementation-neutral despite the legacy class
	 * name retained during migration. */
	readonly runtime?: 'node-datachannel' | 'werift';
	readonly manager: RemoteConnectionManager;
	readonly module?: NodeDataChannelRuntimeModule;
	readonly loadModule?: () => Promise<NodeDataChannelRuntimeModule>;
	/** Opens the authenticated relay stream for one admitted peer. */
	readonly createSignaling: (
		context: HeadlessWebRtcRuntimeContext,
	) => NodeDataChannelSignaling | Promise<NodeDataChannelSignaling>;
	/** Static discovery servers. Credentials are deliberately not accepted here. */
	readonly iceServers?: readonly NodeDataChannelIceServer[];
	/**
	 * Mints credentials for one already-admitted peer. The provider receives only
	 * connection identity, never pairing, reconnect, or application secrets.
	 */
	readonly createTurnCredentials?: (
		context: HeadlessWebRtcRuntimeContext,
	) =>
		| Promise<readonly NodeDataChannelTurnCredential[]>
		| readonly NodeDataChannelTurnCredential[];
	/** Clock injection for credential-expiry validation. */
	readonly now?: () => number;
	readonly bindAddress?: string;
	readonly role?: 'answerer' | 'offerer';
	readonly timeoutMs?: number;
	readonly maxFrameBytes?: number;
	readonly maxBufferedBytes?: number;
	/**
	 * Upper bound for releasing an authenticated relay subscription. A relay
	 * close is external work and must not keep server shutdown or revocation
	 * pending forever.
	 */
	readonly signalingCloseTimeoutMs?: number;
	/** Bound native peers and relay subscriptions held during signaling setup. */
	readonly maxPendingConnections?: number;
	/**
	 * Bound repeated authenticated WebRTC setup attempts before they can open a
	 * relay subscription or construct a native peer. This is distinct from the
	 * pairing and reconnect HTTP admission limits: a valid proof can otherwise
	 * be replayed as a native-setup resource exhaustion attempt while it is
	 * still within its normal server-owned lifetime.
	 */
	readonly connectionRateLimit?: Omit<RemoteRateLimiterOptions, 'now'>;
	readonly onEvent?: (event: NodeDataChannelHostEvent) => void;
}

export interface NodeDataChannelIceServer {
	readonly urls: string | readonly string[];
}

export interface NodeDataChannelTurnCredential
	extends NodeDataChannelIceServer {
	readonly username: string;
	readonly credential: string;
	/** Unix epoch milliseconds; credentials may live for at most ten minutes. */
	readonly expiresAt: number;
}

export interface NodeDataChannelHeadlessHostSnapshot {
	readonly runtime: 'node-datachannel' | 'werift';
	readonly state: 'ready' | 'closed';
	readonly activeSessions: number;
	/** Connections still in admission/signaling/native setup. */
	readonly pendingConnections: number;
	readonly connectAttempts: number;
	readonly connectedSessions: number;
	readonly failedConnections: number;
	/**
	 * Aggregate-only operational measurements for a sustained runtime probe.
	 * These deliberately contain no device, peer, signal, or payload data.
	 */
	readonly measurements: Readonly<{
		readonly peakActiveSessions: number;
		readonly peakPendingConnections: number;
		readonly completedConnections: number;
		readonly totalConnectionDurationMs: number;
		readonly maxConnectionDurationMs: number;
		readonly iceConfigurations: number;
		readonly relayCapableIceConfigurations: number;
		readonly turnCredentialRequests: number;
		readonly turnCredentialFailures: number;
		readonly activeTurnCredentialRequests: number;
		readonly peakActiveTurnCredentialRequests: number;
	}>;
}

/** Metadata-only cleanup performed by the privileged WebRTC host. */
export interface NodeDataChannelHeadlessHostCleanupReport {
	readonly runtime: 'node-datachannel' | 'werift';
	/** Expired per-device WebRTC setup-rate-limit windows removed. */
	readonly connectionRateLimitWindows: number;
}

type ClosableSignaling = NodeDataChannelSignaling & {
	readonly close?: () => void | Promise<void>;
};

/**
 * Privileged server composition for the optional node-datachannel runtime.
 * Admission remains owned by RemoteConnectionManager; this class only wires
 * the admitted peer to its authenticated signaling stream and four-channel
 * headless transport. No renderer or Electron dependency crosses this edge.
 */
export class NodeDataChannelHeadlessHost {
	private readonly runtime: 'node-datachannel' | 'werift';
	private readonly factory: RemoteHeadlessWebRtcFactory;
	private readonly sessions = new Map<string, RemoteHeadlessSession>();
	private readonly signaling = new Map<string, ClosableSignaling>();
	private readonly onEvent:
		| ((event: NodeDataChannelHostEvent) => void)
		| undefined;
	private readonly pendingConnections = new Set<
		Promise<RemoteHeadlessSession>
	>();
	private readonly connectionAbortControllers = new Map<
		AbortController,
		string
	>();
	private readonly maxPendingConnections: number;
	private readonly connectionRateLimiter: RemoteRateLimiter;
	private readonly signalingCloseTimeoutMs: number;
	private readonly now: () => number;
	private loadedModule: NodeDataChannelRuntimeModule | undefined;
	private shutdownPromise: Promise<void> | undefined;
	private closed = false;
	private connectAttempts = 0;
	private connectedSessions = 0;
	private failedConnections = 0;
	private peakActiveSessions = 0;
	private peakPendingConnections = 0;
	private completedConnections = 0;
	private totalConnectionDurationMs = 0;
	private maxConnectionDurationMs = 0;
	private iceConfigurations = 0;
	private relayCapableIceConfigurations = 0;
	private turnCredentialRequests = 0;
	private turnCredentialFailures = 0;
	private activeTurnCredentialRequests = 0;
	private peakActiveTurnCredentialRequests = 0;

	constructor(options: NodeDataChannelHeadlessHostOptions) {
		this.runtime = options.runtime ?? 'node-datachannel';
		if (typeof options.createSignaling !== 'function')
			throw new TypeError('node-datachannel signaling factory is required');
		if (options.module !== undefined && options.loadModule !== undefined)
			throw new TypeError(
				'node-datachannel module and loader are mutually exclusive',
			);
		if (options.module === undefined && options.loadModule === undefined)
			throw new TypeError('node-datachannel module or loader is required');
		this.maxPendingConnections = options.maxPendingConnections ?? 32;
		if (
			!Number.isSafeInteger(this.maxPendingConnections) ||
			this.maxPendingConnections <= 0 ||
			this.maxPendingConnections > 256
		) {
			throw new RangeError(
				'node-datachannel pending connection limit is invalid',
			);
		}
		this.connectionRateLimiter = new RemoteRateLimiter({
			...(options.now === undefined ? {} : { now: options.now }),
			...options.connectionRateLimit,
		});
		this.signalingCloseTimeoutMs = boundedSignalingCloseTimeout(
			options.signalingCloseTimeoutMs ?? DEFAULT_SIGNALING_CLOSE_TIMEOUT_MS,
		);
		this.now = options.now ?? Date.now;

		this.onEvent = options.onEvent;
		this.loadedModule = options.module;
		const staticIceServers = validateStaticIceServers(options.iceServers ?? []);
		const resolveIceServers = async (
			context: HeadlessWebRtcRuntimeContext,
		): Promise<readonly Record<string, unknown>[]> => {
			if (context.signal.aborted)
				throw (
					context.signal.reason ??
					new DOMException('The operation was aborted', 'AbortError')
				);
			this.iceConfigurations += 1;
			let credentials: readonly Record<string, unknown>[] = [];
			if (options.createTurnCredentials !== undefined) {
				this.turnCredentialRequests += 1;
				this.activeTurnCredentialRequests += 1;
				this.peakActiveTurnCredentialRequests = Math.max(
					this.peakActiveTurnCredentialRequests,
					this.activeTurnCredentialRequests,
				);
				try {
					// Credential minting is an external dependency (usually the
					// hosted relay). Abort it with the server-owned peer lifecycle.
					credentials = validateTurnCredentials(
						await abortable(
							context.signal,
							options.createTurnCredentials(context),
						),
						options.now ?? Date.now,
					);
				} catch (error) {
					this.turnCredentialFailures += 1;
					throw error;
				} finally {
					this.activeTurnCredentialRequests -= 1;
				}
			}
			if (context.signal.aborted)
				throw (
					context.signal.reason ??
					new DOMException('The operation was aborted', 'AbortError')
				);
			if (credentials.length > 0) this.relayCapableIceConfigurations += 1;
			return [...staticIceServers, ...credentials];
		};
		const adapter = createNodeDataChannelRuntimeAdapter({
			runtime: this.runtime,
			...(options.module === undefined
				? {
						loadModule: async () => {
							if (this.loadedModule === undefined) {
								this.loadedModule = await options.loadModule!();
							}
							return this.loadedModule;
						},
					}
				: { module: options.module }),
			openChannels: async (module, context) => {
				let signaling: ClosableSignaling | undefined;
				try {
					const iceServers = await resolveIceServers(context);
					// Signaling construction can involve a hosted relay request. Treat it
					// like TURN minting: a shutdown, revocation, or caller cancellation must
					// stop waiting before a late relay handle can open a native peer.
					signaling = (await abortable(
						context.signal,
						options.createSignaling(context),
					)) as ClosableSignaling;
					if (
						signaling === undefined ||
						signaling === null ||
						typeof signaling !== 'object'
					) {
						throw new TypeError(
							'node-datachannel signaling transport is invalid',
						);
					}
					this.signaling.set(context.peerId, signaling);
					const openChannels = createNodeDataChannelOpenChannels({
						signaling,
						...(iceServers.length === 0 ? {} : { iceServers }),
						...(options.bindAddress === undefined
							? {}
							: { bindAddress: options.bindAddress }),
						...(options.role === undefined ? {} : { role: options.role }),
						...(options.timeoutMs === undefined
							? {}
							: { timeoutMs: options.timeoutMs }),
					});
					const channels = await openChannels(module, context);
					const closedChannels = new Set<string>();
					for (const [label, channel] of channels) {
						watchChannelClose(
							channel,
							label,
							context.channels.length,
							closedChannels,
							() => {
								// The native peer can disappear without a host-initiated
								// close (network loss, browser teardown, or a failed data
								// channel). Release the server-owned bookkeeping immediately;
								// waiting for a later snapshot poll would retain an
								// authenticated session and omit its audit transition.
								void this.releaseClosedPeer(context.peerId);
							},
						);
					}
					return channels;
				} catch (error) {
					this.signaling.delete(context.peerId);
					if (signaling !== undefined)
						await closeSignaling(signaling, this.signalingCloseTimeoutMs);
					throw error;
				}
			},
		});
		this.factory = new RemoteHeadlessWebRtcFactory({
			manager: options.manager,
			runtimes: [adapter],
			...(options.maxFrameBytes === undefined
				? {}
				: { maxFrameBytes: options.maxFrameBytes }),
			...(options.maxBufferedBytes === undefined
				? {}
				: { maxBufferedBytes: options.maxBufferedBytes }),
		});
	}

	get runtimeId(): 'node-datachannel' | 'werift' {
		return this.runtime;
	}

	get snapshot(): NodeDataChannelHeadlessHostSnapshot {
		this.pruneSessions();
		this.connectionRateLimiter.cleanup();
		const activeSessions = this.factory.snapshot().length;
		this.peakActiveSessions = Math.max(this.peakActiveSessions, activeSessions);
		return Object.freeze({
			runtime: this.runtime,
			state: this.closed ? 'closed' : 'ready',
			activeSessions,
			pendingConnections: this.pendingConnections.size,
			connectAttempts: this.connectAttempts,
			connectedSessions: this.connectedSessions,
			failedConnections: this.failedConnections,
			measurements: Object.freeze({
				peakActiveSessions: this.peakActiveSessions,
				peakPendingConnections: this.peakPendingConnections,
				completedConnections: this.completedConnections,
				totalConnectionDurationMs: this.totalConnectionDurationMs,
				maxConnectionDurationMs: this.maxConnectionDurationMs,
				iceConfigurations: this.iceConfigurations,
				relayCapableIceConfigurations: this.relayCapableIceConfigurations,
				turnCredentialRequests: this.turnCredentialRequests,
				turnCredentialFailures: this.turnCredentialFailures,
				activeTurnCredentialRequests: this.activeTurnCredentialRequests,
				peakActiveTurnCredentialRequests:
					this.peakActiveTurnCredentialRequests,
			}),
		});
	}

	/**
	 * Prune expired admission metadata without requiring another connection.
	 *
	 * The limiter deliberately receives only a device-scoped opaque key, but it
	 * is still server-owned metadata and must not live forever on an otherwise
	 * idle standalone or Embedded host.
	 */
	cleanup(): NodeDataChannelHeadlessHostCleanupReport {
		this.pruneSessions();
		return Object.freeze({
			runtime: this.runtime,
			connectionRateLimitWindows: this.connectionRateLimiter.cleanup(),
		});
	}

	listSessions(): readonly RemoteHeadlessSessionSnapshot[] {
		this.pruneSessions();
		return this.factory.listSessions();
	}

	connect(
		runtime: HeadlessWebRtcRuntime,
		proof: RemoteAuthProof,
		signal?: AbortSignal,
	): Promise<RemoteHeadlessSession>;
	connect(
		proof: RemoteAuthProof,
		signal?: AbortSignal,
	): Promise<RemoteHeadlessSession>;
	async connect(
		runtimeOrProof: HeadlessWebRtcRuntime | RemoteAuthProof,
		proofOrSignal?: RemoteAuthProof | AbortSignal,
		signal?: AbortSignal,
	): Promise<RemoteHeadlessSession> {
		const proof =
			typeof runtimeOrProof === 'string'
				? (proofOrSignal as RemoteAuthProof)
				: runtimeOrProof;
		const connectionSignal =
			typeof runtimeOrProof === 'string'
				? signal
				: (proofOrSignal as AbortSignal | undefined);
		if (typeof runtimeOrProof === 'string' && runtimeOrProof !== this.runtime) {
			throw new Error(
				`headless WebRTC runtime ${runtimeOrProof} is unavailable`,
			);
		}
		if (this.closed) throw new Error('node-datachannel host is closed');
		// A caller may cancel before this privileged boundary is entered. Do not
		// turn that into an authenticated setup attempt: it must not consume a
		// device retry window or reserve any host lifecycle state merely because
		// the JavaScript caller raced its own cancellation with `connect()`.
		if (connectionSignal?.aborted) {
			throw (
				connectionSignal.reason ??
				new DOMException('The operation was aborted', 'AbortError')
			);
		}
		// This is a JavaScript-facing privileged boundary. Do not let an
		// unvalidated runtime value become a limiter key: `undefined`, `null`,
		// and arbitrary string coercions would otherwise create server-owned
		// admission metadata before RemoteConnectionManager gets to reject the
		// proof. The manager remains the authority for the complete proof, but a
		// valid bounded device identity is required before this host allocates any
		// per-device lifecycle state.
		const deviceId = requireRemoteDeviceId(proof);
		// Reject before manager admission so a reconnect storm cannot allocate
		// another native peer or authenticated relay subscription.
		if (this.pendingConnections.size >= this.maxPendingConnections) {
			throw new Error('node-datachannel pending connection limit reached');
		}
		// A capacity rejection is global host pressure, not an attempt that this
		// device was allowed to begin. Consume only after the bounded pending slot
		// is available so a competing setup cannot burn another device's entire
		// retry window without reaching manager admission, signaling, or native
		// allocation.
		this.connectionRateLimiter.consume(`webrtc:${deviceId}`);
		const controller = new AbortController();
		const abortFromCaller = (): void =>
			controller.abort(connectionSignal?.reason);
		if (connectionSignal?.aborted) abortFromCaller();
		else
			connectionSignal?.addEventListener('abort', abortFromCaller, {
				once: true,
			});
		this.connectionAbortControllers.set(controller, deviceId);
		const startedAt = this.now();
		const operation = this.connectPeer(proof, controller.signal, startedAt);
		this.pendingConnections.add(operation);
		this.peakPendingConnections = Math.max(
			this.peakPendingConnections,
			this.pendingConnections.size,
		);
		try {
			return await operation;
		} finally {
			this.pendingConnections.delete(operation);
			this.connectionAbortControllers.delete(controller);
			connectionSignal?.removeEventListener('abort', abortFromCaller);
		}
	}

	private async connectPeer(
		proof: RemoteAuthProof,
		signal: AbortSignal,
		startedAt: number,
	): Promise<RemoteHeadlessSession> {
		if (this.closed) throw new Error('node-datachannel host is closed');
		this.connectAttempts += 1;
		this.emit({ type: 'connect-started', deviceId: proof.deviceId });
		try {
			const session = await this.factory.connect(this.runtime, proof, signal);
			if (this.closed) {
				await session.close();
				throw new Error('node-datachannel host is closed');
			}
			this.sessions.set(session.peerId, session);
			this.connectedSessions += 1;
			this.peakActiveSessions = Math.max(
				this.peakActiveSessions,
				this.sessions.size,
			);
			this.emit({
				type: 'connected',
				deviceId: session.deviceId,
				peerId: session.peerId,
			});
			return session;
		} catch (error) {
			// The shared factory forwards aborts through a new controller, which
			// carries the generic DOM AbortError rather than this host's revocation
			// or shutdown reason. Preserve the lifecycle cause at the privileged
			// boundary so callers can distinguish an intentional teardown from a
			// failed connection attempt.
			const failure =
				signal.aborted && signal.reason instanceof Error && isAbortError(error)
					? signal.reason
					: error;
			this.failedConnections += 1;
			this.emit({ type: 'connect-failed', deviceId: proof.deviceId });
			throw failure;
		} finally {
			this.recordConnectionDuration(startedAt);
		}
	}

	/** Record only aggregate elapsed time so the host can be measured safely in load probes. */
	private recordConnectionDuration(startedAt: number): void {
		const finishedAt = this.now();
		// Measurement is deliberately aggregate-only, but it still crosses an
		// injected runtime clock boundary. Do not let an extreme (yet finite)
		// clock delta overflow into Infinity and poison status/metrics output.
		const candidate =
			Number.isFinite(startedAt) && Number.isFinite(finishedAt)
				? finishedAt - startedAt
				: 0;
		const elapsed = Number.isFinite(candidate)
			? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, candidate))
			: 0;
		this.completedConnections += 1;
		this.totalConnectionDurationMs = Math.min(
			Number.MAX_SAFE_INTEGER,
			this.totalConnectionDurationMs + elapsed,
		);
		this.maxConnectionDurationMs = Math.max(
			this.maxConnectionDurationMs,
			elapsed,
		);
	}

	async closePeer(peerId: string): Promise<void> {
		const session = this.sessions.get(peerId);
		try {
			if (session !== undefined) await session.close();
			else await this.factory.closePeer(peerId);
		} finally {
			// A native close failure must not retain the authenticated relay
			// subscription. The caller still receives the native error after this
			// best-effort lifecycle cleanup has completed.
			this.releaseSession(peerId);
			await this.closePeerSignaling(peerId);
		}
	}

	async closeAll(): Promise<void> {
		try {
			await this.factory.closeAll();
		} finally {
			// Relay handles have an independent lifetime from the native factory;
			// always release them, even when a native peer reports a close error.
			for (const peerId of [...this.sessions.keys()])
				this.releaseSession(peerId);
			for (const peerId of [...this.signaling.keys()])
				await this.closePeerSignaling(peerId);
		}
	}

	/** Stop exposure fences setup in progress without disconnecting live sessions. */
	abortPendingConnections(): void {
		for (const controller of this.connectionAbortControllers.keys())
			controller.abort(new Error('remote exposure stopped'));
		this.factory.abortPendingConnections();
	}

	async revokeDevice(deviceId: string): Promise<number> {
		// Revocation is terminal for this device identity. Do not retain its
		// opaque native-setup retry window until expiry: it is no longer useful
		// for admission, and keeping it would leave device-scoped lifecycle
		// metadata behind after every revoke. `reset` only deletes an existing
		// key, so an arbitrary revoke request cannot create limiter state.
		this.connectionRateLimiter.reset(`webrtc:${deviceId}`);
		for (const [controller, pendingDeviceId] of this
			.connectionAbortControllers) {
			if (pendingDeviceId === deviceId)
				controller.abort(new Error('remote device is revoked'));
		}
		// Do not make relay-subscription cleanup depend on a native close callback.
		// `RemoteHeadlessSession.close()` releases the server-core session even if a
		// node-datachannel binding never publishes its own terminal event, but this
		// host owns the separate authenticated signaling handle. Capture the peer
		// IDs before the factory removes its sessions so device revocation always
		// closes that handle as part of the same lifecycle boundary.
		const peerIds = [...this.sessions.values()]
			.filter((session) => session.deviceId === deviceId)
			.map((session) => session.peerId);
		const count = await this.factory.revokeDevice(deviceId);
		for (const peerId of peerIds) {
			this.releaseSession(peerId);
			await this.closePeerSignaling(peerId);
		}
		this.pruneSessions();
		return count;
	}

	private async closePeerSignaling(peerId: string): Promise<void> {
		const signaling = this.signaling.get(peerId);
		if (signaling !== undefined) {
			this.signaling.delete(peerId);
			await closeSignaling(signaling, this.signalingCloseTimeoutMs);
		}
	}

	private async releaseClosedPeer(peerId: string): Promise<void> {
		this.releaseSession(peerId);
		await this.closePeerSignaling(peerId);
	}

	/** Publish each terminal peer lifecycle transition exactly once. */
	private releaseSession(peerId: string): void {
		const session = this.sessions.get(peerId);
		if (session === undefined) return;
		this.sessions.delete(peerId);
		this.emit({ type: 'session-closed', peerId, deviceId: session.deviceId });
	}

	shutdown(): Promise<void> {
		// Server shutdown can be requested concurrently by a process signal and
		// the embedding composition. Every caller must wait for the same native
		// and relay cleanup work; returning merely because `closed` was set would
		// allow one caller to tear down its process while resources remain live.
		if (this.shutdownPromise !== undefined) return this.shutdownPromise;
		this.shutdownPromise = this.shutdownImpl();
		return this.shutdownPromise;
	}

	private async shutdownImpl(): Promise<void> {
		this.closed = true;
		for (const controller of this.connectionAbortControllers.keys())
			controller.abort(new Error('node-datachannel host is shutting down'));
		await Promise.allSettled([...this.pendingConnections]);
		try {
			await this.closeAll();
		} finally {
			// The optional native module may own process-level resources. Release it
			// and publish terminal shutdown state even if an individual peer failed
			// its close operation.
			try {
				await this.loadedModule?.cleanup?.();
			} finally {
				this.emit({ type: 'shutdown' });
			}
		}
	}

	private pruneSessions(): void {
		const active = new Set(
			this.factory.listSessions().map((session) => session.peerId),
		);
		for (const peerId of this.sessions.keys()) {
			if (active.has(peerId)) continue;
			this.releaseSession(peerId);
		}
	}

	private emit(event: NodeDataChannelHostEvent): void {
		// Host observers feed metrics/audit presentation and must not be able to
		// interrupt a privileged connection lifecycle. In particular, a throwing
		// `connect-started` observer previously escaped before the factory could
		// finish (or fail) the setup, leaving the caller with a misleading failure
		// caused by observability rather than the authenticated transport.
		try {
			this.onEvent?.(event);
		} catch {
			/* Observability cannot veto server-owned session lifecycle work. */
		}
	}
}

/**
 * Relay cleanup is external work. Always observe its eventual settlement, but
 * do not let a faulty or unavailable relay prevent the server-owned peer,
 * module, and process cleanup path from completing.
 */
function closeSignaling(
	signaling: ClosableSignaling | undefined,
	timeoutMs: number,
): Promise<void> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolve();
		};
		const timeout = setTimeout(finish, timeoutMs);
		Promise.resolve()
			.then(() => signaling?.close?.())
			.then(finish, finish);
	});
}

const MAX_TURN_CREDENTIAL_LIFETIME_MS = 10 * 60 * 1000;
const DEFAULT_SIGNALING_CLOSE_TIMEOUT_MS = 5_000;
const MAX_SIGNALING_CLOSE_TIMEOUT_MS = 60_000;

function boundedSignalingCloseTimeout(value: number): number {
	if (
		!Number.isSafeInteger(value) ||
		value < 1 ||
		value > MAX_SIGNALING_CLOSE_TIMEOUT_MS
	)
		throw new RangeError('node-datachannel signaling close timeout is invalid');
	return value;
}

/** Static discovery configuration deliberately cannot carry credentials. */
function validateStaticIceServers(
	servers: readonly NodeDataChannelIceServer[],
): readonly Record<string, unknown>[] {
	if (!Array.isArray(servers) || servers.length > 8)
		throw new TypeError('node-datachannel static ICE servers are invalid');
	return servers.map((server) => {
		if (
			server === null ||
			typeof server !== 'object' ||
			Reflect.has(server, 'username') ||
			Reflect.has(server, 'credential')
		)
			throw new TypeError(
				'node-datachannel static ICE credentials are not allowed',
			);
		return { urls: validateIceUrls(server.urls, false) };
	});
}

/** Per-admitted-peer TURN credentials are bounded and never surfaced in errors. */
function validateTurnCredentials(
	credentials: readonly NodeDataChannelTurnCredential[],
	now: () => number,
): readonly Record<string, unknown>[] {
	if (!Array.isArray(credentials) || credentials.length > 8)
		throw new TypeError('node-datachannel TURN credentials are invalid');
	const current = now();
	if (!Number.isSafeInteger(current) || current < 0)
		throw new TypeError('node-datachannel TURN credential clock is invalid');
	return credentials.map((credential) => {
		if (
			credential === null ||
			typeof credential !== 'object' ||
			typeof credential.username !== 'string' ||
			credential.username.length === 0 ||
			credential.username.length > 512 ||
			typeof credential.credential !== 'string' ||
			credential.credential.length === 0 ||
			credential.credential.length > 2048 ||
			!Number.isSafeInteger(credential.expiresAt) ||
			credential.expiresAt <= current ||
			credential.expiresAt > current + MAX_TURN_CREDENTIAL_LIFETIME_MS
		)
			throw new TypeError(
				'node-datachannel TURN credential is invalid or not short-lived',
			);
		return {
			urls: validateIceUrls(credential.urls, true),
			username: credential.username,
			credential: credential.credential,
		};
	});
}

function validateIceUrls(
	value: string | readonly string[],
	requireTurn: boolean,
): string | readonly string[] {
	const urls = typeof value === 'string' ? [value] : value;
	if (
		!Array.isArray(urls) ||
		urls.length === 0 ||
		urls.length > 4 ||
		urls.some(
			(url) =>
				typeof url !== 'string' ||
				url.length === 0 ||
				url.length > 2048 ||
				!new RegExp(requireTurn ? '^turns?:' : '^stuns?:', 'i').test(url),
		)
	)
		throw new TypeError('node-datachannel ICE server URL is invalid');
	return typeof value === 'string' ? urls[0]! : [...urls];
}

function watchChannelClose(
	channel: NodeDataChannelLike,
	label: string,
	channelCount: number,
	closedChannels: Set<string>,
	onAllClosed: () => void,
): void {
	channel.onClosed(() => {
		closedChannels.add(label);
		if (closedChannels.size === channelCount) onAllClosed();
	});
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException
		? error.name === 'AbortError'
		: error instanceof Error && error.name === 'AbortError';
}

/**
 * Validate the only proof field this host uses before server-core admission.
 * RemoteConnectionManager validates the whole proof later, but this keeps the
 * host's rate-limit and cancellation maps free of malformed untrusted input.
 */
function requireRemoteDeviceId(proof: unknown): string {
	if (
		proof === null ||
		typeof proof !== 'object' ||
		!Reflect.has(proof, 'deviceId') ||
		typeof (proof as { readonly deviceId?: unknown }).deviceId !== 'string' ||
		!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(
			(proof as { readonly deviceId: string }).deviceId,
		)
	)
		throw new TypeError('node-datachannel remote device identity is invalid');
	return (proof as { readonly deviceId: string }).deviceId;
}

/** Await an external setup dependency without allowing it to outlive host abort. */
function abortable<T>(
	signal: AbortSignal,
	operation: Promise<T> | T,
): Promise<T> {
	if (signal.aborted) {
		return Promise.reject(
			signal.reason ??
				new DOMException('The operation was aborted', 'AbortError'),
		);
	}
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const settle = (callback: () => void): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', onAbort);
			callback();
		};
		const onAbort = (): void =>
			settle(() =>
				reject(
					signal.reason ??
						new DOMException('The operation was aborted', 'AbortError'),
				),
			);
		signal.addEventListener('abort', onAbort, { once: true });
		Promise.resolve(operation).then(
			(value) => settle(() => resolve(value)),
			(error: unknown) => settle(() => reject(error)),
		);
	});
}
