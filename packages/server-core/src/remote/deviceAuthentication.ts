import {
	constants,
	createPublicKey,
	randomBytes as nodeRandomBytes,
	verify,
} from 'node:crypto';
import type { ProtocolId } from '@terminay/protocol';

export interface RemoteDeviceAuthenticationOptions {
	readonly serverId: ProtocolId;
	readonly sessionOrigin: string;
	readonly now?: () => number;
	readonly challengeTtlMs?: number;
	readonly ticketTtlMs?: number;
	readonly maxChallenges?: number;
	readonly randomBytes?: (size: number) => Uint8Array;
}

export interface RemoteRegisteredDevice {
	readonly deviceId: ProtocolId;
	readonly deviceName: string;
	readonly publicKeyPem: string;
	readonly createdAt: number;
	readonly lastSeenAt: number;
	readonly revokedAt: number | null;
}

export interface RemoteDeviceChallenge {
	readonly challengeId: ProtocolId;
	readonly serverId: ProtocolId;
	readonly sessionOrigin: string;
	readonly deviceId: ProtocolId;
	readonly nonce: string;
	readonly issuedAt: number;
	readonly expiresAt: number;
	readonly protocolVersion: 'v1';
}

export interface RemoteDeviceConnectionTicket {
	readonly ticket: string;
	readonly ticketId: ProtocolId;
	readonly serverId: ProtocolId;
	readonly sessionOrigin: string;
	readonly deviceId: ProtocolId;
	readonly expiresAt: number;
	/** The transport peer this ticket was issued on. A ticket presented by any
	 * other peer is spent without granting anything. */
	readonly peerId: ProtocolId | null;
}

interface PendingChallenge {
	readonly challenge: RemoteDeviceChallenge;
	readonly signingInput: string;
}

interface TicketRecord {
	readonly ticket: RemoteDeviceConnectionTicket;
	used: boolean;
}

const DEFAULT_CHALLENGE_TTL_MS = 60_000;
const DEFAULT_TICKET_TTL_MS = 60_000;
const DEFAULT_MAX_CHALLENGES = 64;
const RSA_PSS_SALT_LENGTH = 32;
const DOMAIN = 'terminay\u0000v1\u0000device-authentication\u0000';

/**
 * Server-owned device enrollment and authentication authority. The only
 * durable credential is a registered public key. Challenges and connection
 * tickets are short lived and remain entirely server-owned.
 */
export class RemoteDeviceAuthentication {
	private readonly now: () => number;
	private readonly challengeTtlMs: number;
	private readonly ticketTtlMs: number;
	private readonly maxChallenges: number;
	private readonly randomBytes: (size: number) => Uint8Array;
	private readonly devices = new Map<ProtocolId, RemoteRegisteredDevice>();
	private readonly challenges = new Map<ProtocolId, PendingChallenge>();
	private readonly tickets = new Map<string, TicketRecord>();
	private sequence = 0;

	constructor(private readonly options: RemoteDeviceAuthenticationOptions) {
		if (!validId(options.serverId) || !validOrigin(options.sessionOrigin))
			throw new TypeError('remote server identity/origin is invalid');
		this.now = options.now ?? (() => Date.now());
		this.challengeTtlMs = positive(
			options.challengeTtlMs ?? DEFAULT_CHALLENGE_TTL_MS,
			'challengeTtlMs',
		);
		this.ticketTtlMs = positive(
			options.ticketTtlMs ?? DEFAULT_TICKET_TTL_MS,
			'ticketTtlMs',
		);
		this.maxChallenges = positive(
			options.maxChallenges ?? DEFAULT_MAX_CHALLENGES,
			'maxChallenges',
		);
		this.randomBytes =
			options.randomBytes ?? ((size) => new Uint8Array(nodeRandomBytes(size)));
	}

	get serverId(): ProtocolId {
		return this.options.serverId;
	}

	get sessionOrigin(): string {
		return this.options.sessionOrigin;
	}

	enroll(input: {
		readonly deviceId?: ProtocolId;
		readonly deviceName: string;
		readonly publicKeyPem: string;
	}): RemoteRegisteredDevice {
		if (input.deviceId !== undefined && !validId(input.deviceId)) throw new TypeError('remote device identity is invalid');
		if (!validDeviceName(input.deviceName))
			throw new TypeError('remote device name is invalid');
		assertRsaPssPublicKey(input.publicKeyPem);
		const now = this.currentTime();
		const deviceId = input.deviceId ?? this.nextId('device');
		const existing = this.devices.get(deviceId);
		if (existing !== undefined) {
			if (existing.revokedAt !== null) throw new Error('remote device is revoked');
			if (existing.publicKeyPem !== input.publicKeyPem)
				throw new Error('remote device key does not match');
			const next: RemoteRegisteredDevice = {
				...existing,
				deviceName: input.deviceName,
				lastSeenAt: now,
			};
			this.devices.set(deviceId, next);
			return snapshotDevice(next);
		}
		const device: RemoteRegisteredDevice = {
			deviceId,
			deviceName: input.deviceName,
			publicKeyPem: input.publicKeyPem,
			createdAt: now,
			lastSeenAt: now,
			revokedAt: null,
		};
		this.devices.set(device.deviceId, device);
		return snapshotDevice(device);
	}

	restore(devices: readonly RemoteRegisteredDevice[]): void {
		for (const device of devices) {
			if (!isStoredDevice(device))
				throw new TypeError('persisted remote device is invalid');
			assertRsaPssPublicKey(device.publicKeyPem);
			if (this.devices.has(device.deviceId))
				throw new TypeError('persisted remote device is duplicated');
			this.devices.set(device.deviceId, snapshotDevice(device));
		}
	}

	listDevices(): readonly RemoteRegisteredDevice[] {
		return Object.freeze([...this.devices.values()].map(snapshotDevice));
	}

	list(): readonly RemoteRegisteredDevice[] {
		return this.listDevices();
	}

	getDevice(deviceId: ProtocolId): RemoteRegisteredDevice | undefined {
		const device = this.devices.get(deviceId);
		return device === undefined ? undefined : snapshotDevice(device);
	}

	get(deviceId: ProtocolId): RemoteRegisteredDevice | undefined {
		return this.getDevice(deviceId);
	}

	revokeDevice(deviceId: ProtocolId): boolean {
		const device = this.devices.get(deviceId);
		if (device === undefined || device.revokedAt !== null) return false;
		const revoked = { ...device, revokedAt: this.currentTime() };
		this.devices.set(deviceId, revoked);
		for (const [challengeId, pending] of this.challenges)
			if (pending.challenge.deviceId === deviceId) this.challenges.delete(challengeId);
		for (const [token, record] of this.tickets)
			if (record.ticket.deviceId === deviceId) this.tickets.delete(token);
		return true;
	}

	createChallenge(deviceId: ProtocolId): {
		readonly challenge: RemoteDeviceChallenge;
		readonly signingInput: string;
	} {
		this.cleanup();
		const device = this.requireActiveDevice(deviceId);
		if (this.challenges.size >= this.maxChallenges)
			throw new Error('remote challenge limit reached');
		const issuedAt = this.currentTime();
		const challenge: RemoteDeviceChallenge = Object.freeze({
			challengeId: this.nextId('challenge'),
			serverId: this.options.serverId,
			sessionOrigin: this.options.sessionOrigin,
			deviceId: device.deviceId,
			nonce: this.token(32),
			issuedAt,
			expiresAt: issuedAt + this.challengeTtlMs,
			protocolVersion: 'v1',
		});
		const signingInput = serializeRemoteDeviceChallenge(challenge);
		this.challenges.set(challenge.challengeId, { challenge, signingInput });
		return Object.freeze({ challenge, signingInput });
	}

	verify(input: {
		readonly deviceId: ProtocolId;
		readonly challengeId: ProtocolId;
		readonly deviceSignature: string;
		readonly peerId?: ProtocolId;
	}): RemoteDeviceConnectionTicket {
		this.cleanup();
		const pending = this.challenges.get(input.challengeId);
		if (
			pending === undefined ||
			pending.challenge.deviceId !== input.deviceId ||
			pending.challenge.serverId !== this.options.serverId ||
			pending.challenge.sessionOrigin !== this.options.sessionOrigin
		)
			throw new Error('remote device challenge is unavailable');
		const device = this.requireActiveDevice(input.deviceId);
		if (!validSignature(input.deviceSignature))
			throw new Error('remote device signature is invalid');
		const valid = verify(
			'sha256',
			Buffer.from(pending.signingInput, 'utf8'),
			{
				key: device.publicKeyPem,
				padding: constants.RSA_PKCS1_PSS_PADDING,
				saltLength: RSA_PSS_SALT_LENGTH,
			},
			Buffer.from(input.deviceSignature, 'base64url'),
		);
		if (!valid) throw new Error('remote device signature is invalid');
		this.challenges.delete(input.challengeId);
		return this.issueConnectionTicket(device.deviceId, input.peerId);
	}

	/** Mint a one-use application ticket after pairing enrollment or a signed challenge. */
	issueConnectionTicket(deviceId: ProtocolId, peerId?: ProtocolId): RemoteDeviceConnectionTicket {
		this.cleanup();
		const device = this.requireActiveDevice(deviceId);
		if (peerId !== undefined && !validId(peerId)) throw new TypeError('remote peer identity is invalid');
		const expiresAt = this.currentTime() + this.ticketTtlMs;
		const ticket: RemoteDeviceConnectionTicket = Object.freeze({
			ticket: this.token(32),
			ticketId: this.nextId('ticket'),
			serverId: this.options.serverId,
			sessionOrigin: this.options.sessionOrigin,
			deviceId: device.deviceId,
			expiresAt,
			peerId: peerId ?? null,
		});
		this.tickets.set(ticket.ticket, { ticket, used: false });
		this.devices.set(device.deviceId, {
			...device,
			lastSeenAt: this.currentTime(),
		});
		return ticket;
	}

	consumeTicket(token: string, peerId?: ProtocolId): RemoteDeviceConnectionTicket {
		this.cleanup();
		const record = this.tickets.get(token);
		if (record === undefined || record.used)
			throw new Error('remote ticket is invalid or already used');
		// A ticket bound to a peer is spent by any presentation, including a
		// wrong one: replay across peers must not leave a second chance behind.
		record.used = true;
		this.tickets.delete(token);
		if (record.ticket.peerId !== null && record.ticket.peerId !== peerId)
			throw new Error('remote ticket belongs to another peer');
		const device = this.requireActiveDevice(record.ticket.deviceId);
		this.devices.set(device.deviceId, { ...device, lastSeenAt: this.currentTime() });
		return record.ticket;
	}

	cleanup(): number {
		const now = this.currentTime();
		let removed = 0;
		for (const [id, pending] of this.challenges)
			if (pending.challenge.expiresAt <= now) {
				this.challenges.delete(id);
				removed += 1;
			}
		for (const [token, record] of this.tickets)
			if (record.used || record.ticket.expiresAt <= now) {
				this.tickets.delete(token);
				removed += 1;
			}
		return removed;
	}

	private requireActiveDevice(deviceId: ProtocolId): RemoteRegisteredDevice {
		if (!validId(deviceId)) throw new TypeError('remote device identity is invalid');
		const device = this.devices.get(deviceId);
		if (device === undefined) throw new Error('remote device is not registered');
		if (device.revokedAt !== null) throw new Error('remote device is revoked');
		return device;
	}

	private currentTime(): number {
		const now = this.now();
		if (!Number.isSafeInteger(now) || now < 0)
			throw new Error('remote clock is invalid');
		return now;
	}

	private nextId(prefix: string): ProtocolId {
		this.sequence += 1;
		return `${prefix}-${this.sequence.toString(36)}-${this.token(12)}`;
	}

	private token(bytes: number): string {
		const value = this.randomBytes(bytes);
		if (!(value instanceof Uint8Array) || value.byteLength !== bytes)
			throw new TypeError('remote entropy generator returned an invalid length');
		return Buffer.from(value).toString('base64url');
	}
}

export function serializeRemoteDeviceChallenge(
	challenge: RemoteDeviceChallenge,
): string {
	return [
		DOMAIN,
		challenge.protocolVersion,
		challenge.challengeId,
		challenge.serverId,
		challenge.sessionOrigin,
		challenge.deviceId,
		challenge.nonce,
		String(challenge.issuedAt),
		String(challenge.expiresAt),
	].join('\u0000');
}

function assertRsaPssPublicKey(value: string): void {
	if (typeof value !== 'string' || value.length < 64 || value.length > 16_384)
		throw new TypeError('remote device public key is invalid');
	try {
		const key = createPublicKey(value);
		if (key.asymmetricKeyType !== 'rsa')
			throw new TypeError('remote device public key must be RSA');
		const details = key.asymmetricKeyDetails;
		if (details?.modulusLength === undefined || details.modulusLength < 2048)
			throw new TypeError('remote device public key is too small');
	} catch (error) {
		throw error instanceof TypeError
			? error
			: new TypeError('remote device public key is invalid');
	}
}

function snapshotDevice(device: RemoteRegisteredDevice): RemoteRegisteredDevice {
	return Object.freeze({ ...device });
}

function isStoredDevice(value: RemoteRegisteredDevice): boolean {
	return (
		validId(value.deviceId) &&
		validDeviceName(value.deviceName) &&
		typeof value.publicKeyPem === 'string' &&
		validTimestamp(value.createdAt) &&
		validTimestamp(value.lastSeenAt) &&
		(value.revokedAt === null || validTimestamp(value.revokedAt))
	);
}

function validId(value: string): value is ProtocolId {
	return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function validDeviceName(value: string): boolean {
	return typeof value === 'string' && value.trim().length > 0 && value.length <= 128 && !/[\0\r\n]/u.test(value);
}

function validTimestamp(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 0;
}

function validSignature(value: string): boolean {
	return typeof value === 'string' && value.length >= 32 && value.length <= 2048 && /^[A-Za-z0-9_-]+$/u.test(value);
}

function validOrigin(value: string): boolean {
	try {
		const url = new URL(value);
		const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname.endsWith('.localhost');
		return (url.protocol === 'https:' || (url.protocol === 'http:' && local)) && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/';
	} catch {
		return false;
	}
}

function positive(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new RangeError(`${name} must be positive`);
	return value;
}
