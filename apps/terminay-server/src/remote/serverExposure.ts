import { randomBytes } from 'node:crypto';
import { hostname as osHostname } from 'node:os';
import type {
	RemoteAuditLog,
	RemoteAuditLogOptions,
	RemoteAuthProof,
	RemoteCleanupReport,
	RemoteConnectionManagerOptions,
	RemoteDeviceAuthenticationOptions,
	RemoteExposureController,
	RemoteExposureStatus,
	RemoteHeadlessSession,
	RemotePairingAttempt,
	RemotePairingHandoff,
	RemoteRateLimiterOptions,
} from '@terminay/server-core/remote';
import {
	RemoteAuditLog as AuditLog,
	RemoteDeviceAuthentication,
	RemoteExposureController as ExposureController,
	RemoteConnectionManager,
	RemotePairingStore,
	RemoteRateLimiter,
} from '@terminay/server-core/remote';
import {
	NodeDataChannelHeadlessHost,
	type NodeDataChannelHeadlessHostOptions,
	type NodeDataChannelHostEvent,
} from './nodeDataChannelHost.js';
import {
	formatHostedPairingUrl,
	managerOriginFromSessionOrigin,
} from '@terminay/protocol';
import { deriveHostedPairingSecrets, hostedSessionId } from './hostedPairingSecrets.js';

const HOSTED_PAIRING_LIFETIME_MS = 5 * 60 * 1000;
const HOSTED_RECONNECT_AVAILABILITY_MS = 25 * 60 * 1000;

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
	readonly deviceAuthentication?: Omit<
		RemoteDeviceAuthenticationOptions,
		'serverId' | 'sessionOrigin' | 'now'
	>;
	readonly pairingRateLimit?: RemoteRateLimiterOptions;
	readonly deviceAuthenticationRateLimit?: RemoteRateLimiterOptions;
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
	/** Hosted QR links are advertised on the manager origin; Local HTTP uses named fragment fields. */
	readonly pairingUrlFormat?:
		| 'standalone'
		| 'direct-device'
		| 'hosted-compact';
	/** Non-secret machine name shown as the default browser connection label. */
	readonly hostName?: string;
}

export interface ServerRemoteCleanupReport extends RemoteCleanupReport {
	readonly deviceAuthenticationRecords: number;
	readonly deviceAuthenticationRateLimitWindows: number;
	readonly headlessRuntime: 'node-datachannel' | 'werift' | null;
	readonly headlessRateLimitWindows: number;
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
 * device-key metadata, audit, admission limits, and cleanup stay here while
 * SDP/ICE and native peer lifecycle stay inside the injected host.
 */
export class ServerRemoteExposure {
	readonly manager: RemoteConnectionManager;
	readonly pairing: RemotePairingStore;
	readonly devices: RemoteDeviceAuthentication;
	readonly audit: RemoteAuditLog;
	readonly controller: RemoteExposureController;
	readonly nodeDataChannelHost: NodeDataChannelHeadlessHost | undefined;
	private readonly deviceAuthenticationRateLimiter: RemoteRateLimiter;
	private readonly cleanupTimer: ReturnType<typeof setInterval> | undefined;
	private shutdownPromise: Promise<void> | undefined;
	private activePairingHandoff: ServerPairingHandoff | undefined;
	private readonly pairingUrlFormat:
		| 'standalone'
		| 'direct-device'
		| 'hosted-compact';
	private readonly hostName: string;
	private readonly now: () => number;
	private readonly pairingLifetimeMs: number;

	constructor(options: ServerRemoteExposureOptions) {
		const now = options.now ?? (() => Date.now());
		this.now = now;
		this.pairingLifetimeMs =
			options.defaultLifetimeMs ??
			options.pairing?.defaultLifetimeMs ??
			HOSTED_PAIRING_LIFETIME_MS;
		this.pairingUrlFormat = options.pairingUrlFormat ?? 'standalone';
		this.hostName = sanitizePairingHostName(options.hostName ?? osHostname());
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
		this.devices = new RemoteDeviceAuthentication({
			...options.deviceAuthentication,
			serverId: options.serverId,
			sessionOrigin: options.sessionOrigin,
			now,
		});
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
		this.deviceAuthenticationRateLimiter = new RemoteRateLimiter({
			now,
			...options.deviceAuthenticationRateLimit,
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
						// The exposure owns lifecycle time. Pairing, device authentication, and
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

	get advertisedHostName(): string {
		return this.hostName;
	}

	start(expiresAt?: number): ServerPairingHandoff {
		if (this.pairingUrlFormat !== 'hosted-compact') {
			return this.rememberHandoff(this.controller.start(expiresAt));
		}
		if (this.manager.exposure.state === 'exposed') {
			throw new Error('remote exposure is already active');
		}
		const qrSecret = mintHostedQrSecret();
		const derived = deriveHostedPairingSecrets(qrSecret);
		const pairingExpiresAt = expiresAt ?? this.now() + this.pairingLifetimeMs;
		this.ensureExposureCovers(pairingExpiresAt);
		try {
			const room = this.pairing.createIdentified({
				expiresAt: pairingExpiresAt,
				roomId: derived.pairingRoomId,
				secret: derived.pairingToken,
			});
			this.audit.record({ action: 'exposure-started', roomId: room.roomId });
			return this.rememberHandoff({
				...room,
				compactQrSecret: qrSecret,
				pairingUrl: room.sessionOrigin,
			});
		} catch (error) {
			this.manager.stopExposure();
			throw error;
		}
	}

	rotate(expiresAt?: number): ServerPairingHandoff {
		if (this.pairingUrlFormat === 'hosted-compact') {
			return this.rotateHostedPairing(expiresAt);
		}
		return this.rememberHandoff(this.controller.rotate(expiresAt));
	}

	/** Mint a replacement hosted pairing room without dropping reconnect availability. */
	rotateHostedPairing(expiresAt?: number): ServerPairingHandoff {
		if (this.pairingUrlFormat !== 'hosted-compact') {
			return this.rotate(expiresAt);
		}
		if (this.manager.exposure.state !== 'exposed') {
			throw new Error('remote exposure is not active');
		}
		const qrSecret = mintHostedQrSecret();
		const derived = deriveHostedPairingSecrets(qrSecret);
		const pairingExpiresAt = expiresAt ?? this.now() + this.pairingLifetimeMs;
		this.ensureExposureCovers(pairingExpiresAt);
		const room = this.pairing.rotateIdentified({
			expiresAt: pairingExpiresAt,
			roomId: derived.pairingRoomId,
			secret: derived.pairingToken,
		});
		this.audit.record({ action: 'exposure-rotated', roomId: room.roomId });
		return this.rememberHandoff({
			...room,
			compactQrSecret: qrSecret,
			pairingUrl: room.sessionOrigin,
		});
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
		if (device === undefined) throw new Error('remote device is not registered');
		if (device.revokedAt !== null) throw new Error('remote device is revoked');
		return this.controller.connectHeadless(
			this.nodeDataChannelHost?.runtimeId ?? 'node-datachannel',
			attempt,
			proof,
			signal,
		);
	}

	/** Enroll a durable public device key after the one-time pairing admission. */
	enrollDevice(input: {
		readonly pairingSessionId: string;
		readonly pairingToken: string;
		readonly deviceName: string;
		readonly publicKeyPem: string;
	}) {
		const pairingAttempt = {
			roomId: input.pairingSessionId,
			serverId: this.devices.serverId,
			sessionOrigin: this.devices.sessionOrigin,
			secret: input.pairingToken,
		};
		this.pairing.assertAvailable(pairingAttempt);
		const device = this.devices.enroll({
			deviceName: input.deviceName,
			publicKeyPem: input.publicKeyPem,
		});
		this.pairing.consume(pairingAttempt);
		this.audit.record({ action: 'device-registered', deviceId: device.deviceId });
		return device;
	}

	issueConnectionTicket(deviceId: string) {
		return this.devices.issueConnectionTicket(deviceId);
	}

	createDeviceChallenge(deviceId: string) {
		this.deviceAuthenticationRateLimiter.consume(`device:${deviceId}`);
		return this.devices.createChallenge(deviceId);
	}

	verifyDeviceSignature(input: {
		readonly deviceId: string;
		readonly challengeId: string;
		readonly deviceSignature: string;
	}) {
		const ticket = this.devices.verify(input);
		this.deviceAuthenticationRateLimiter.reset(`device:${input.deviceId}`);
		return ticket;
	}

	consumeConnectionTicket(token: string) {
		return this.devices.consumeTicket(token);
	}

	async revokeDevice(deviceId: string): Promise<number> {
		const count = await this.controller.revokeDevice(deviceId);
		this.devices.revokeDevice(deviceId);
		this.audit.record({ action: 'device-revoked', deviceId });
		return count;
	}

	cleanup(): ServerRemoteCleanupReport {
		const exposure = this.controller.cleanup();
		const headlessCleanup = this.nodeDataChannelHost?.cleanup();
		return Object.freeze({
			...exposure,
			deviceAuthenticationRecords: this.devices.cleanup(),
			deviceAuthenticationRateLimitWindows:
				this.deviceAuthenticationRateLimiter.cleanup(),
			// The node-datachannel host owns a distinct authenticated setup limiter.
			// It must participate in the server-owned timer/manual cleanup path;
			// otherwise an idle exposed server would retain per-device admission
			// metadata until a caller happened to inspect the native host directly.
			headlessRuntime: headlessCleanup?.runtime ?? null,
			headlessRateLimitWindows:
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

	private rememberHandoff(
		handoff: RemotePairingHandoff & { readonly compactQrSecret?: string },
	): ServerPairingHandoff {
		const projected = toServerPairingHandoff(
			handoff,
			this.pairingUrlFormat,
			this.hostName,
		);
		this.activePairingHandoff = projected;
		return projected;
	}

	private ensureExposureCovers(pairingExpiresAt: number): void {
		const minExpiry = Math.max(
			pairingExpiresAt,
			this.now() + HOSTED_RECONNECT_AVAILABILITY_MS,
		);
		const exposedUntil = this.manager.exposure.expiresAt ?? 0;
		if (
			this.manager.exposure.state !== 'exposed' ||
			exposedUntil < pairingExpiresAt
		) {
			this.manager.expose(minExpiry);
		}
	}
}

export function createServerRemoteExposure(
	options: ServerRemoteExposureOptions,
): ServerRemoteExposure {
	return new ServerRemoteExposure(options);
}

function toServerPairingHandoff(
	handoff: RemotePairingHandoff & { readonly compactQrSecret?: string },
	format: 'standalone' | 'direct-device' | 'hosted-compact',
	hostName: string,
): ServerPairingHandoff {
	const pairingExpiresAt = new Date(handoff.expiresAt).toISOString();
	const pairingSessionId = handoff.roomId;
	const pairingToken = handoff.secret;
	const url = new URL(handoff.sessionOrigin);
	if (format === 'hosted-compact') {
		return Object.freeze({
			...handoff,
			pairingExpiresAt,
			pairingSessionId,
			pairingToken,
			pairingUrl: formatHostedPairingUrl({
				fragment: handoff.compactQrSecret ?? handoff.secret,
				hostName,
				managerOrigin: managerOriginFromSessionOrigin(handoff.sessionOrigin),
				pairingExpiresAt,
				sessionId: hostedSessionId(handoff.sessionOrigin),
			}),
		});
	}
	url.pathname = '/';
	url.hash = new URLSearchParams({
		...(format === 'direct-device' ? { pairingFlow: 'device' } : {}),
		pairingExpiresAt,
		pairingSessionId,
		pairingToken,
		...(hostName ? { hostName } : {}),
	}).toString();
	return Object.freeze({
		...handoff,
		pairingExpiresAt,
		pairingSessionId,
		pairingToken,
		pairingUrl: url.toString(),
	});
}

function sanitizePairingHostName(value: string): string {
	let name = value.trim();
	if (name.toLowerCase().endsWith('.local')) name = name.slice(0, -'.local'.length);
	name = name.replaceAll('_', '-').slice(0, 80);
	if (
		name.length === 0 ||
		[...name].some((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code < 0x20 || code === 0x7f;
		})
	) {
		return '';
	}
	return name;
}

/** HKDF room ids are base64url; pairing ProtocolIds cannot start with `_` or `-`. */
function mintHostedQrSecret(): string {
	for (let attempt = 0; attempt < 8; attempt += 1) {
		const qrSecret = Buffer.from(randomBytes(32)).toString('base64url');
		const roomId = deriveHostedPairingSecrets(qrSecret).pairingRoomId;
		if (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(roomId)) return qrSecret;
	}
	throw new Error('hosted pairing room identity could not be derived');
}
