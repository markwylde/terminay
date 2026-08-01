import type {
	RemoteAuditLog,
	RemoteAuditLogOptions,
	RemoteAuthProof,
	RemoteCleanupReport,
	RemoteConnectionManagerOptions,
	RemoteDeviceStore,
	RemoteExposureController,
	RemoteExposureStatus,
	RemoteHeadlessSession,
	RemotePairingAttempt,
	RemotePairingHandoff,
	RemoteRateLimiterOptions,
	RemoteReconnectChallenge,
	RemoteReconnectGrantLifetime,
	RemoteReconnectGrantRecord,
	RemoteReconnectGrantStoreOptions,
} from '@terminay/server-core';
import {
	RemoteAuditLog as AuditLog,
	RemoteDeviceStore as DeviceStore,
	RemoteExposureController as ExposureController,
	RemoteConnectionManager,
	RemotePairingStore,
	RemoteRateLimiter,
	RemoteReconnectGrantStore,
} from '@terminay/server-core';
import {
	NodeDataChannelHeadlessHost,
	type NodeDataChannelHeadlessHostOptions,
	type NodeDataChannelHostEvent,
} from './nodeDataChannelHost.js';

export interface ServerRemoteExposureOptions {
	readonly serverId: string;
	readonly sessionOrigin: string;
	readonly now?: () => number;
	readonly defaultLifetimeMs?: number;
	readonly manager?: Omit<
		RemoteConnectionManagerOptions,
		'serverId' | 'sessionOrigin'
	>;
	readonly pairing?: {
		readonly maxRooms?: number;
		readonly maxFailedAttempts?: number;
		readonly defaultLifetimeMs?: number;
		readonly maxLifetimeMs?: number;
		readonly randomBytes?: (size: number) => Uint8Array;
	};
	readonly reconnect?: Omit<
		RemoteReconnectGrantStoreOptions,
		'serverId' | 'sessionOrigin' | 'now'
	>;
	readonly pairingRateLimit?: RemoteRateLimiterOptions;
	readonly reconnectRateLimit?: RemoteRateLimiterOptions;
	readonly audit?: RemoteAuditLog;
	readonly auditSink?: RemoteAuditLogOptions['sink'];
	readonly nodeDataChannel?: Omit<
		NodeDataChannelHeadlessHostOptions,
		'manager' | 'onEvent'
	>;
	readonly createHeadlessHost?: (
		manager: RemoteConnectionManager,
		onEvent: (event: NodeDataChannelHostEvent) => void,
	) => NodeDataChannelHeadlessHost;
	readonly cleanupIntervalMs?: number;
	/** Hosted `/v1/` QR links use one raw derivation secret; Local HTTP uses named fields. */
	readonly pairingUrlFormat?: 'standalone' | 'hosted-compact';
}

export interface ServerRemoteCleanupReport extends RemoteCleanupReport {
	readonly reconnectChallenges: number;
	readonly reconnectRateLimitWindows: number;
	readonly headlessRuntime: 'node-datachannel' | 'werift' | null;
	readonly headlessRateLimitWindows: number;
	/** Expired node-datachannel authenticated-setup limiter windows removed. */
	/** @deprecated Use headlessRateLimitWindows. */
	readonly nodeDataChannelRateLimitWindows: number;
}

/**
 * Pairing material as understood by the bundled remote client. The token is
 * still the same one-time secret retained by RemotePairingStore; these names
 * are the wire/bootstrap contract, not a second credential.
 */
export interface ServerPairingHandoff extends RemotePairingHandoff {
	readonly pairingSessionId: string;
	readonly pairingToken: string;
	readonly pairingExpiresAt: string;
}

/**
 * Complete server-owned remote authority. It is the composition seam between
 * the server runtime and the concrete node-datachannel host: pairing rooms,
 * device/grant metadata, audit, admission limits, and cleanup stay here while
 * SDP/ICE and native peer lifecycle stay inside the injected host.
 */
export class ServerRemoteExposure {
	readonly manager: RemoteConnectionManager;
	readonly pairing: RemotePairingStore;
	readonly reconnect: RemoteReconnectGrantStore;
	readonly devices: RemoteDeviceStore;
	readonly audit: RemoteAuditLog;
	readonly controller: RemoteExposureController;
	readonly nodeDataChannelHost: NodeDataChannelHeadlessHost | undefined;
	private readonly reconnectRateLimiter: RemoteRateLimiter;
	private readonly cleanupTimer: ReturnType<typeof setInterval> | undefined;
	private shutdownPromise: Promise<void> | undefined;
	private activePairingHandoff: ServerPairingHandoff | undefined;
	private readonly pairingUrlFormat: 'standalone' | 'hosted-compact';

	constructor(options: ServerRemoteExposureOptions) {
		const now = options.now ?? (() => Date.now());
		this.pairingUrlFormat = options.pairingUrlFormat ?? 'standalone';
		this.manager = new RemoteConnectionManager({
			...options.manager,
			serverId: options.serverId,
			sessionOrigin: options.sessionOrigin,
			now,
		});
		this.pairing = new RemotePairingStore({
			...options.pairing,
			serverId: options.serverId,
			sessionOrigin: options.sessionOrigin,
			now,
		});
		this.reconnect = new RemoteReconnectGrantStore({
			...options.reconnect,
			serverId: options.serverId,
			sessionOrigin: options.sessionOrigin,
			now,
		});
		this.devices = new DeviceStore(now);
		this.audit =
			options.audit ??
			new AuditLog({
				serverId: options.serverId,
				now,
				...(options.auditSink === undefined ? {} : { sink: options.auditSink }),
			});
		const pairingRateLimiter = new RemoteRateLimiter({
			now,
			...options.pairingRateLimit,
		});
		this.reconnectRateLimiter = new RemoteRateLimiter({
			now,
			...options.reconnectRateLimit,
		});
		if (
			options.nodeDataChannel !== undefined &&
			options.createHeadlessHost !== undefined
		) {
			throw new TypeError(
				'remote exposure headless host options are mutually exclusive',
			);
		}
		this.nodeDataChannelHost =
			options.createHeadlessHost !== undefined
				? options.createHeadlessHost(this.manager, (event) =>
						this.onHostEvent(event),
					)
				: options.nodeDataChannel === undefined
					? undefined
					: new NodeDataChannelHeadlessHost({
						...options.nodeDataChannel,
						// The exposure owns lifecycle time. Pairing, reconnect grants, and
						// native setup rate limits must use one clock or cleanup can report
						// an expired server ledger while the native host retains it.
						now,
						manager: this.manager,
						onEvent: (event) => this.onHostEvent(event),
					});
		this.controller = new ExposureController({
			manager: this.manager,
			pairing: this.pairing,
			...(this.nodeDataChannelHost === undefined
				? {}
				: { headless: this.nodeDataChannelHost }),
			now,
			...(options.defaultLifetimeMs === undefined
				? {}
				: { defaultLifetimeMs: options.defaultLifetimeMs }),
			audit: this.audit,
			pairingRateLimiter,
		});
		const cleanupIntervalMs = options.cleanupIntervalMs ?? 60_000;
		if (
			!Number.isSafeInteger(cleanupIntervalMs) ||
			cleanupIntervalMs < 0 ||
			cleanupIntervalMs > 60 * 60 * 1000
		) {
			throw new RangeError('remote cleanup interval is invalid');
		}
		if (cleanupIntervalMs > 0) {
			const timer = setInterval(() => this.cleanup(), cleanupIntervalMs);
			timer.unref?.();
			this.cleanupTimer = timer;
		}
	}

	get status(): RemoteExposureStatus {
		return this.controller.status;
	}

	get pairingHandoff(): ServerPairingHandoff | undefined {
		return this.activePairingHandoff;
	}

	start(expiresAt?: number): ServerPairingHandoff {
		return this.rememberHandoff(this.controller.start(expiresAt));
	}

	rotate(expiresAt?: number): ServerPairingHandoff {
		return this.rememberHandoff(this.controller.rotate(expiresAt));
	}

	createPairing(expiresAt?: number): ServerPairingHandoff {
		return this.rememberHandoff(this.controller.createPairing(expiresAt));
	}

	stopExposure(): RemoteExposureStatus {
		const status = this.controller.stopExposure();
		this.activePairingHandoff = undefined;
		return status;
	}

	async connectHeadless(
		attempt: RemotePairingAttempt,
		proof: RemoteAuthProof,
		signal?: AbortSignal,
	): Promise<RemoteHeadlessSession> {
		const device = this.devices.get(proof.deviceId);
		if (device !== undefined && device.revokedAt !== null)
			throw new Error('remote device is revoked');
		const registered = this.devices.register(proof.deviceId);
		if (device === undefined)
			this.audit.record({
				action: 'device-registered',
				deviceId: registered.deviceId,
			});
		return this.controller.connectHeadless(
			this.nodeDataChannelHost?.runtimeId ?? 'node-datachannel',
			attempt,
			proof,
			signal,
		);
	}

	issueReconnectGrant(options: {
		readonly deviceId: string;
		readonly lifetime?: RemoteReconnectGrantLifetime | string | null;
	}): ReturnType<RemoteReconnectGrantStore['issue']> {
		const device = this.devices.get(options.deviceId);
		if (device !== undefined && device.revokedAt !== null)
			throw new Error('remote device is revoked');
		this.devices.register(options.deviceId);
		const issued = this.reconnect.issue(options);
		this.audit.record({
			action: 'reconnect-grant-issued',
			deviceId: options.deviceId,
		});
		return issued;
	}

	createReconnectChallenge(
		options: Parameters<RemoteReconnectGrantStore['createChallenge']>[0],
	): {
		readonly challenge: RemoteReconnectChallenge;
		readonly signingInput: string;
	} {
		// Do not let untrusted, nonexistent handles consume the bounded server
		// limiter ledger. A valid handle is opaque and server-owned; only that
		// retryable grant is entitled to an admission window.
		this.reconnect.assertAvailable(options.handle, options.origin);
		this.reconnectRateLimiter.consume(`reconnect:${options.handle}`);
		return this.reconnect.createChallenge(options);
	}

	verifyReconnectProof(
		options: Parameters<RemoteReconnectGrantStore['verifyProof']>[0],
	): RemoteReconnectGrantRecord {
		const record = this.reconnect.verifyProof(options);
		// Only a complete, verified reconnect earns a fresh retry window. Creating
		// challenges alone must remain bounded so a holder cannot fill the relay's
		// finite pending-challenge capacity.
		this.reconnectRateLimiter.reset(`reconnect:${record.handle}`);
		return record;
	}

	async revokeDevice(deviceId: string): Promise<number> {
		const count = await this.controller.revokeDevice(deviceId);
		this.devices.revoke(deviceId);
		this.reconnect.revokeDevice(deviceId);
		this.audit.record({ action: 'reconnect-grant-revoked', deviceId });
		return count;
	}

	cleanup(): ServerRemoteCleanupReport {
		const exposure = this.controller.cleanup();
		const headlessCleanup = this.nodeDataChannelHost?.cleanup();
		return Object.freeze({
			...exposure,
			reconnectChallenges: this.reconnect.cleanup(),
			reconnectRateLimitWindows: this.reconnectRateLimiter.cleanup(),
			// The node-datachannel host owns a distinct authenticated setup limiter.
			// It must participate in the server-owned timer/manual cleanup path;
			// otherwise an idle exposed server would retain per-device admission
			// metadata until a caller happened to inspect the native host directly.
			headlessRuntime: headlessCleanup?.runtime ?? null,
			headlessRateLimitWindows:
				headlessCleanup?.connectionRateLimitWindows ?? 0,
			nodeDataChannelRateLimitWindows:
				headlessCleanup?.connectionRateLimitWindows ?? 0,
		});
	}

	async shutdown(): Promise<void> {
		if (this.shutdownPromise !== undefined) return this.shutdownPromise;
		if (this.cleanupTimer !== undefined) clearInterval(this.cleanupTimer);
		this.shutdownPromise = (async () => {
			await this.controller.shutdown();
			await this.nodeDataChannelHost?.shutdown();
		})();
		return this.shutdownPromise;
	}

	private onHostEvent(event: NodeDataChannelHostEvent): void {
		if (event.type === 'session-closed') {
			this.audit.record({
				action: 'peer-closed',
				peerId: event.peerId,
				deviceId: event.deviceId,
			});
		}
	}

	private rememberHandoff(handoff: RemotePairingHandoff): ServerPairingHandoff {
		const projected = toServerPairingHandoff(handoff, this.pairingUrlFormat);
		this.activePairingHandoff = projected;
		return projected;
	}
}

export function createServerRemoteExposure(
	options: ServerRemoteExposureOptions,
): ServerRemoteExposure {
	return new ServerRemoteExposure(options);
}

function toServerPairingHandoff(
	handoff: RemotePairingHandoff,
	format: 'standalone' | 'hosted-compact',
): ServerPairingHandoff {
	const pairingExpiresAt = new Date(handoff.expiresAt).toISOString();
	const pairingSessionId = handoff.roomId;
	const pairingToken = handoff.secret;
	const url = new URL(handoff.sessionOrigin);
	if (format === 'hosted-compact') {
		url.pathname = '/v1/';
		// The hosted `/v1/` client derives its room, signaling, pairing, and asset
		// secrets from this compact QR secret.
		url.hash = handoff.secret;
	} else {
		url.pathname = '/';
		url.hash = new URLSearchParams({
			pairingExpiresAt,
			pairingSessionId,
			pairingToken,
		}).toString();
	}
	return Object.freeze({
		...handoff,
		pairingExpiresAt,
		pairingSessionId,
		pairingToken,
		pairingUrl: url.toString(),
	});
}
