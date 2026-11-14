import type {
	HostedConnectedPeer,
	HostedPairingHost,
} from './hostedPairingHost.js';
import {
	createPairingOperationQueue,
	createSharedPairingHandoffRotator,
} from './pairingOperationQueue.js';
import {
	projectRemoteAccessStatus,
	type RemoteAccessConnection,
	type RemoteAccessStatus,
} from './remoteAccessStatus.js';
import type {
	ServerPairingHandoff,
	ServerRemoteExposure,
} from './serverExposure.js';

export type StandaloneExposureMode = 'hosted' | 'direct';

/** Callbacks the controller needs from every pairing host it starts. */
export interface StandalonePairingHostHooks {
	readonly onPeerConnected: (peer: HostedConnectedPeer) => void;
	readonly onPeerDisconnected: (connectionId: string) => void;
	readonly onHandoff: (handoff: ServerPairingHandoff) => void;
	readonly onDevicesPersisted: () => void;
}

export interface StandaloneRemoteAccessOptions {
	readonly remote: ServerRemoteExposure;
	/** The `--expose` modes. Runtime exposure starts these, or hosted when
	 * there are none (ADR-0120). */
	readonly configuredModes: readonly StandaloneExposureMode[];
	/** The handoff `remote.start()` minted at startup. */
	readonly initialHandoff: ServerPairingHandoff;
	/** Called before a runtime exposure mints its room, for a server whose
	 * startup handoff was a local pairing fragment rather than an exposure
	 * room. Its presence means the initial handoff is never advertised. */
	readonly prepareRuntimeExposure?: () => void;
	/** Mint a replacement room on `remote`. */
	readonly rotateHandoff: () => ServerPairingHandoff;
	/** The same room as one mode's client reaches it. */
	readonly handoffForMode: (
		mode: StandaloneExposureMode,
		handoff: ServerPairingHandoff,
	) => ServerPairingHandoff;
	readonly startPairingHost: (
		mode: StandaloneExposureMode,
		input: Readonly<{
			handoff: ServerPairingHandoff;
			rotateHandoff: () => Promise<ServerPairingHandoff>;
			hooks: StandalonePairingHostHooks;
		}>,
	) => Promise<HostedPairingHost>;
	/** Persist the device registry after a revocation. */
	readonly persistDevices: () => void;
	/** Replace the server host key. Throws when it cannot be written. */
	readonly rotateHostKey: () => void;
	/** Throws when this server must not be exposed (for example it has no
	 * workspace UI to serve). */
	readonly assertExposable?: () => void;
	/** How long a disruptive command waits after answering before it closes
	 * connections, so its answer reaches a caller it is about to disconnect. */
	readonly responseGraceMs?: number;
}

export interface PairingHandoffByMode {
	readonly mode: StandaloneExposureMode;
	readonly handoff: ServerPairingHandoff;
}

const DEFAULT_RESPONSE_GRACE_MS = 250;

/**
 * Runtime control of a standalone server's exposure (ADR-0120). Startup
 * `--expose` and client `remote-access.*` commands both drive this one
 * controller, so they share one room, one device registry, and one approval
 * queue.
 */
export class StandaloneRemoteAccess {
	private readonly options: StandaloneRemoteAccessOptions;
	private readonly queue = createPairingOperationQueue();
	private readonly listeners = new Set<() => void>();
	private readonly graceMs: number;
	private hosts: Array<{
		readonly mode: StandaloneExposureMode;
		readonly host: HostedPairingHost;
	}> = [];
	private connections = new Map<
		string,
		RemoteAccessConnection & { readonly mode: StandaloneExposureMode }
	>();
	private exposed = false;
	private handoff: ServerPairingHandoff;
	private handoffAdvertised = false;
	private errorMessage: string | null = null;
	private readonly unsubscribe: Array<() => void> = [];
	private closed = false;

	constructor(options: StandaloneRemoteAccessOptions) {
		this.options = options;
		this.handoff = options.initialHandoff;
		this.handoffAdvertised = options.prepareRuntimeExposure !== undefined;
		this.graceMs = options.responseGraceMs ?? DEFAULT_RESPONSE_GRACE_MS;
		this.unsubscribe.push(
			options.remote.onApprovalRequested(() => this.changed()),
			options.remote.onApprovalResolved(() => this.changed()),
		);
	}

	/** The modes runtime exposure starts. */
	get exposureModes(): readonly StandaloneExposureMode[] {
		return this.options.configuredModes.length > 0
			? this.options.configuredModes
			: ['hosted'];
	}

	/** The modes currently exposed; empty when exposure is stopped. */
	get activeModes(): readonly StandaloneExposureMode[] {
		return this.exposed ? this.hosts.map((entry) => entry.mode) : [];
	}

	get isExposed(): boolean {
		return this.exposed;
	}

	/** The live room as each running mode's client reaches it. */
	handoffs(): readonly PairingHandoffByMode[] {
		return this.activeModes.map((mode) => ({
			mode,
			handoff: this.options.handoffForMode(mode, this.handoff),
		}));
	}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	status(): RemoteAccessStatus {
		const preferred = this.handoffs();
		const shown =
			preferred.find((entry) => entry.mode === 'hosted') ?? preferred[0];
		return projectRemoteAccessStatus({
			exposure: this.options.remote,
			isRunning: this.exposed,
			hasSessionOrigin: true,
			pairingUrl: shown?.handoff.pairingUrl ?? null,
			hostedConnections: [...this.connections.values()].map(
				({ mode: _mode, ...connection }) => connection,
			),
			errorMessage: this.errorMessage,
		});
	}

	/** `remote-access.toggle-server`. */
	toggle(): Promise<RemoteAccessStatus> {
		return this.queue.run(async () =>
			this.exposed ? this.stopNow() : this.exposeNow(),
		);
	}

	/** Start the exposure modes. Resolves once every mode registered, or
	 * rejects with the first failure after closing what it started. */
	expose(): Promise<RemoteAccessStatus> {
		return this.queue.run(async () => {
			if (this.exposed) return this.status();
			const status = await this.exposeNow();
			if (!this.exposed)
				throw new Error(this.errorMessage ?? 'exposure did not start');
			return status;
		});
	}

	stop(): Promise<RemoteAccessStatus> {
		return this.queue.run(async () =>
			this.exposed ? this.stopNow() : this.status(),
		);
	}

	/** Mint one replacement room on every running mode. */
	createPairingLink(): Promise<RemoteAccessStatus> {
		return this.queue.run(async () => {
			if (!this.exposed) throw new Error('Remote Access is not exposed.');
			await this.mintOnEveryHost();
			return this.status();
		});
	}

	/** Mint a replacement room when asked, then report each mode's room. */
	pairingHandoffs(rotate: boolean): Promise<readonly PairingHandoffByMode[]> {
		return this.queue.run(async () => {
			if (rotate && this.exposed) await this.mintOnEveryHost();
			return this.handoffs();
		});
	}

	approveDevice(approvalId: string) {
		return this.queue.run(async () => {
			const resolution = this.options.remote.approveEnrollment(approvalId);
			await this.waitForRefresh();
			this.changed();
			return resolution;
		});
	}

	denyDevice(approvalId: string) {
		return this.queue.run(async () => {
			const approval = this.options.remote.denyEnrollment(approvalId);
			await this.waitForRefresh();
			this.changed();
			return approval;
		});
	}

	revokeDevice(deviceId: string): Promise<RemoteAccessStatus> {
		return this.queue.run(async () => {
			await this.options.remote.revokeDevice(deviceId);
			this.options.persistDevices();
			this.changed();
			return this.status();
		});
	}

	/** Close a live connection. A hosted connection belongs to a device, and
	 * closing it closes every window that device has open; the device stays
	 * trusted. */
	closeConnection(connectionId: string): Promise<RemoteAccessStatus> {
		return this.queue.run(async () => {
			const hosted = this.connections.get(connectionId);
			if (hosted !== undefined) {
				for (const { host } of this.hosts)
					await host.closeDevice(hosted.deviceId);
				for (const [id, connection] of [...this.connections])
					if (connection.deviceId === hosted.deviceId)
						this.connections.delete(id);
			} else {
				this.options.remote.manager.closePeer(connectionId);
			}
			this.changed();
			return this.status();
		});
	}

	/**
	 * Explicit trust reset: a new host key first (nothing else changes if it
	 * cannot be written), then every device revoked, and every running mode
	 * registered again under the new key once the answer has gone out.
	 */
	resetIdentity(): Promise<RemoteAccessStatus> {
		return this.queue.run(async () => {
			this.options.rotateHostKey();
			const wasExposed = this.exposed;
			const answer = {
				...this.status(),
				pairedDeviceCount: 0,
				pairedDevices: [],
				pendingApprovals: [],
				connections: [],
				activeConnectionCount: 0,
			};
			void this.queue.run(async () => {
				await this.delay();
				try {
					await this.options.remote.revokeAllDevices();
				} finally {
					try {
						this.options.persistDevices();
					} catch (error) {
						this.errorMessage = messageOf(error);
					}
				}
				if (wasExposed) {
					await this.closeHosts();
					this.exposed = false;
					await this.exposeNow();
				}
				this.changed();
			});
			return answer;
		});
	}

	async shutdown(): Promise<void> {
		this.closed = true;
		for (const stop of this.unsubscribe.splice(0)) stop();
		await this.queue.run(async () => {
			this.exposed = false;
			await this.closeHosts();
		});
		this.listeners.clear();
	}

	private async exposeNow(): Promise<RemoteAccessStatus> {
		if (this.closed) throw new Error('remote access is shut down');
		try {
			this.options.assertExposable?.();
		} catch (error) {
			this.errorMessage = messageOf(error);
			this.changed();
			return this.status();
		}
		const modes = this.exposureModes;
		this.options.prepareRuntimeExposure?.();
		// A room a previous exposure advertised may already have been joined;
		// each exposure generation starts from a fresh one.
		if (this.handoffAdvertised) this.handoff = this.options.rotateHandoff();
		this.handoffAdvertised = true;
		const rotateShared = createSharedPairingHandoffRotator({
			modes,
			initialHandoff: this.handoff,
			rotate: () => {
				this.handoff = this.options.rotateHandoff();
				return this.handoff;
			},
		});
		const started: Array<{
			mode: StandaloneExposureMode;
			host: HostedPairingHost;
		}> = [];
		try {
			for (const mode of modes) {
				const host = await this.options.startPairingHost(mode, {
					handoff: this.options.handoffForMode(mode, this.handoff),
					rotateHandoff: async () =>
						this.options.handoffForMode(mode, await rotateShared(mode)),
					hooks: this.hooksFor(mode),
				});
				started.push({ mode, host });
			}
		} catch (error) {
			for (const { host } of started) await host.close().catch(() => undefined);
			this.errorMessage = messageOf(error);
			this.changed();
			return this.status();
		}
		this.hosts = started;
		this.exposed = true;
		this.errorMessage = null;
		this.changed();
		return this.status();
	}

	private stopNow(): RemoteAccessStatus {
		this.exposed = false;
		this.errorMessage = null;
		const hosts = this.hosts;
		this.hosts = [];
		this.connections.clear();
		this.options.remote.closePendingApprovals();
		// Answer first: the caller may be one of the connections about to close.
		void this.queue.run(async () => {
			await this.delay();
			for (const { host } of hosts) await host.close().catch(() => undefined);
		});
		this.changed();
		return this.status();
	}

	private async closeHosts(): Promise<void> {
		const hosts = this.hosts;
		this.hosts = [];
		this.connections.clear();
		for (const { host } of hosts) await host.close().catch(() => undefined);
	}

	private async mintOnEveryHost(): Promise<void> {
		for (const { host } of this.hosts) await host.mintPairing();
		this.changed();
	}

	private async waitForRefresh(): Promise<void> {
		await Promise.all(
			this.hosts.map(({ host }) => host.waitForPairingRefresh()),
		);
	}

	private hooksFor(mode: StandaloneExposureMode): StandalonePairingHostHooks {
		return {
			onPeerConnected: (peer) => {
				this.connections.set(peer.connectionId, {
					attachedSessionCount: 1,
					connectionId: peer.connectionId,
					deviceId: peer.deviceId,
					deviceName: peer.deviceName,
					mode,
				});
				this.changed();
			},
			onPeerDisconnected: (connectionId) => {
				if (this.connections.delete(connectionId)) this.changed();
			},
			onHandoff: () => this.changed(),
			onDevicesPersisted: () => this.changed(),
		};
	}

	private delay(): Promise<void> {
		return this.graceMs <= 0
			? Promise.resolve()
			: new Promise((resolve) => {
					const timer = setTimeout(resolve, this.graceMs);
					timer.unref?.();
				});
	}

	private changed(): void {
		for (const listener of [...this.listeners]) {
			try {
				listener();
			} catch {
				// An observer never undoes an exposure change.
			}
		}
	}
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
