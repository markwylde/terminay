import { randomBytes } from 'node:crypto';
import { hostname as osHostname } from 'node:os';
import { isMatchCode, PENDING_APPROVAL_LIFETIME_MS } from '@terminay/protocol';
import type {
	RemoteAuditLog,
	RemoteAuditLogOptions,
	RemoteCleanupReport,
	RemoteConnectionManagerOptions,
	RemoteDeviceAuthenticationOptions,
	RemoteExposureController,
	RemoteExposureStatus,
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
	readonly expiredApprovals: number;
}

/**
 * One device waiting for the administrator to approve its match code. The
 * device public key is held here, not in the device registry, until approval;
 * deny, expiry, room rotation, or peer closure discards it and enrolls nothing.
 */
export interface PendingEnrollmentApproval {
	readonly approvalId: string;
	readonly roomId: string;
	readonly deviceName: string;
	readonly publicKeyPem: string;
	readonly matchCode: string;
	readonly peerId: string;
	readonly createdAt: number;
	readonly expiresAt: number;
}

/** Non-secret view for exposure surfaces: no device key, no room secret. */
export type PendingEnrollmentApprovalSummary = Readonly<{
	approvalId: string;
	deviceName: string;
	matchCode: string;
	expiresAt: number;
}>;

export type EnrollmentApprovalResolution =
	| Readonly<{
			outcome: 'approved';
			approval: PendingEnrollmentApproval;
			deviceId: string;
			deviceName: string;
			ticket: string;
	  }>
	| Readonly<{
			outcome: 'denied' | 'expired' | 'replaced' | 'closed';
			approval: PendingEnrollmentApproval;
	  }>;

export type EnrollmentApprovalListener = (resolution: EnrollmentApprovalResolution) => void;
export type PendingApprovalListener = (approval: PendingEnrollmentApprovalSummary) => void;

const MAX_PENDING_APPROVALS = 16;
const APPROVAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

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
	private readonly pendingApprovals = new Map<string, PendingEnrollmentApproval>();
	private readonly approvalListeners = new Set<EnrollmentApprovalListener>();
	private readonly pendingListeners = new Set<PendingApprovalListener>();
	private approvalSequence = 0;

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
		this.controller = new ExposureController({
			manager: this.manager,
			pairing: this.pairing,
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
		this.resolvePendingApprovals(() => true, 'replaced');
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
		this.resolvePendingApprovals(() => true, 'closed');
		const status = this.controller.stopExposure();
		this.activePairingHandoff = undefined;
		return status;
	}

	/**
	 * Park an enrollment request until the administrator approves its match
	 * code. The pairing secret is checked now so a wrong fragment fails fast,
	 * but the room is consumed only on approval. One request per room: a
	 * second device racing the same QR is refused rather than queued, so the
	 * code on the host always belongs to exactly one visible request.
	 */
	requestEnrollment(input: {
		readonly pairingSessionId: string;
		readonly pairingToken: string;
		readonly deviceName: string;
		readonly publicKeyPem: string;
		readonly matchCode: string;
		readonly peerId: string;
	}): PendingEnrollmentApprovalSummary {
		this.expirePendingApprovals();
		const pairingAttempt = {
			roomId: input.pairingSessionId,
			serverId: this.devices.serverId,
			sessionOrigin: this.devices.sessionOrigin,
			secret: input.pairingToken,
		};
		this.pairing.assertAvailable(pairingAttempt);
		if (!isMatchCode(input.matchCode)) throw new TypeError('pairing match code is invalid');
		if (!APPROVAL_ID_PATTERN.test(input.peerId)) throw new TypeError('remote peer identity is invalid');
		const deviceName = normalizeDeviceName(input.deviceName);
		assertEnrollablePublicKey(this.devices, input.publicKeyPem);
		for (const pending of this.pendingApprovals.values()) {
			if (pending.roomId === input.pairingSessionId) {
				throw new Error('another device is already waiting for approval on this pairing link');
			}
		}
		if (this.pendingApprovals.size >= MAX_PENDING_APPROVALS) {
			throw new Error('too many devices are waiting for approval');
		}
		const createdAt = this.now();
		this.approvalSequence += 1;
		const approval: PendingEnrollmentApproval = Object.freeze({
			approvalId: `approval-${this.approvalSequence.toString(36)}-${randomBytes(9).toString('base64url')}`,
			roomId: input.pairingSessionId,
			deviceName,
			publicKeyPem: input.publicKeyPem,
			matchCode: input.matchCode,
			peerId: input.peerId,
			createdAt,
			expiresAt: createdAt + PENDING_APPROVAL_LIFETIME_MS,
		});
		this.pendingApprovals.set(approval.approvalId, approval);
		this.audit.record({ action: 'approval-requested', roomId: approval.roomId, peerId: approval.peerId });
		const summary = summarizeApproval(approval);
		for (const listener of this.pendingListeners) listener(summary);
		return summary;
	}

	/** The administrator confirmed the match code. Enroll, consume the room, and
	 * mint a ticket bound to the peer that asked. */
	approveEnrollment(approvalId: string): Extract<EnrollmentApprovalResolution, { outcome: 'approved' }> {
		this.expirePendingApprovals();
		const approval = this.pendingApprovals.get(approvalId);
		if (approval === undefined) throw new Error('pairing approval is no longer pending');
		this.pendingApprovals.delete(approvalId);
		const device = this.enrollDevice({
			pairingSessionId: approval.roomId,
			pairingToken: this.roomSecretFor(approval),
			deviceName: approval.deviceName,
			publicKeyPem: approval.publicKeyPem,
		});
		const ticket = this.devices.issueConnectionTicket(device.deviceId, approval.peerId);
		this.audit.record({ action: 'approval-approved', roomId: approval.roomId, deviceId: device.deviceId, peerId: approval.peerId });
		const resolution = Object.freeze({
			outcome: 'approved' as const,
			approval,
			deviceId: device.deviceId,
			deviceName: device.deviceName,
			ticket: ticket.ticket,
		});
		for (const listener of this.approvalListeners) listener(resolution);
		return resolution;
	}

	denyEnrollment(approvalId: string): PendingEnrollmentApproval {
		this.expirePendingApprovals();
		const approval = this.pendingApprovals.get(approvalId);
		if (approval === undefined) throw new Error('pairing approval is no longer pending');
		this.resolvePendingApprovals((pending) => pending.approvalId === approvalId, 'denied');
		return approval;
	}

	/** Discard requests whose peer went away; nothing is enrolled. */
	cancelPendingApprovalsForPeer(peerId: string): number {
		return this.resolvePendingApprovals((pending) => pending.peerId === peerId, 'closed');
	}

	listPendingApprovals(): readonly PendingEnrollmentApprovalSummary[] {
		this.expirePendingApprovals();
		return Object.freeze([...this.pendingApprovals.values()].map(summarizeApproval));
	}

	onApprovalResolved(listener: EnrollmentApprovalListener): () => void {
		this.approvalListeners.add(listener);
		return () => this.approvalListeners.delete(listener);
	}

	onApprovalRequested(listener: PendingApprovalListener): () => void {
		this.pendingListeners.add(listener);
		return () => this.pendingListeners.delete(listener);
	}

	/** Revoke every registered device. Used by an explicit server identity reset. */
	async revokeAllDevices(): Promise<number> {
		this.resolvePendingApprovals(() => true, 'closed');
		let revoked = 0;
		for (const device of this.devices.list()) {
			if (device.revokedAt !== null) continue;
			await this.revokeDevice(device.deviceId);
			revoked += 1;
		}
		this.audit.record({ action: 'identity-reset' });
		return revoked;
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

	issueConnectionTicket(deviceId: string, peerId?: string) {
		return this.devices.issueConnectionTicket(deviceId, peerId);
	}

	createDeviceChallenge(deviceId: string) {
		this.deviceAuthenticationRateLimiter.consume(`device:${deviceId}`);
		return this.devices.createChallenge(deviceId);
	}

	verifyDeviceSignature(input: {
		readonly deviceId: string;
		readonly challengeId: string;
		readonly deviceSignature: string;
		readonly peerId?: string;
	}) {
		const ticket = this.devices.verify(input);
		this.deviceAuthenticationRateLimiter.reset(`device:${input.deviceId}`);
		return ticket;
	}

	consumeConnectionTicket(token: string, peerId?: string) {
		return this.devices.consumeTicket(token, peerId);
	}

	async revokeDevice(deviceId: string): Promise<number> {
		const count = await this.controller.revokeDevice(deviceId);
		this.devices.revokeDevice(deviceId);
		this.audit.record({ action: 'device-revoked', deviceId });
		return count;
	}

	cleanup(): ServerRemoteCleanupReport {
		const exposure = this.controller.cleanup();
		return Object.freeze({
			...exposure,
			deviceAuthenticationRecords: this.devices.cleanup(),
			deviceAuthenticationRateLimitWindows:
				this.deviceAuthenticationRateLimiter.cleanup(),
			expiredApprovals: this.expirePendingApprovals(),
		});
	}

	private expirePendingApprovals(): number {
		const now = this.now();
		return this.resolvePendingApprovals((pending) => pending.expiresAt <= now, 'expired');
	}

	private resolvePendingApprovals(
		match: (pending: PendingEnrollmentApproval) => boolean,
		outcome: 'denied' | 'expired' | 'replaced' | 'closed',
	): number {
		let count = 0;
		for (const [approvalId, pending] of [...this.pendingApprovals]) {
			if (!match(pending)) continue;
			this.pendingApprovals.delete(approvalId);
			count += 1;
			this.audit.record({
				action: outcome === 'expired' ? 'approval-expired' : 'approval-denied',
				roomId: pending.roomId,
				peerId: pending.peerId,
			});
			const resolution = Object.freeze({ outcome, approval: pending });
			for (const listener of this.approvalListeners) listener(resolution);
		}
		return count;
	}

	/** The room secret is only ever held by the active handoff; a pending
	 * approval for any other room has already been replaced. */
	private roomSecretFor(approval: PendingEnrollmentApproval): string {
		const handoff = this.activePairingHandoff;
		if (handoff === undefined || handoff.pairingSessionId !== approval.roomId) {
			throw new Error('pairing room is unavailable');
		}
		return handoff.pairingToken;
	}

	async shutdown(): Promise<void> {
		if (this.shutdownPromise !== undefined) return this.shutdownPromise;
		if (this.cleanupTimer !== undefined) clearInterval(this.cleanupTimer);
		this.shutdownPromise = (async () => {
			await this.controller.shutdown();
		})();
		return this.shutdownPromise;
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

function summarizeApproval(approval: PendingEnrollmentApproval): PendingEnrollmentApprovalSummary {
	return Object.freeze({
		approvalId: approval.approvalId,
		deviceName: approval.deviceName,
		matchCode: approval.matchCode,
		expiresAt: approval.expiresAt,
	});
}

function normalizeDeviceName(value: string): string {
	const name = String(value ?? '').trim().replace(/[\0\r\n]/gu, '').slice(0, 128);
	return name.length === 0 ? 'Browser' : name;
}

/** Validate the device key up front so a malformed key never parks a request. */
function assertEnrollablePublicKey(devices: RemoteDeviceAuthentication, publicKeyPem: string): void {
	if (typeof publicKeyPem !== 'string' || publicKeyPem.length < 64 || publicKeyPem.length > 16_384) {
		throw new TypeError('remote device public key is invalid');
	}
	for (const device of devices.list()) {
		if (device.publicKeyPem === publicKeyPem && device.revokedAt === null) {
			throw new Error('remote device key is already registered');
		}
	}
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
