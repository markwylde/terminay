import {
	createHash,
	randomBytes as nodeRandomBytes,
	timingSafeEqual,
} from 'node:crypto';
import type { ProtocolId } from '@terminay/protocol';

export type RemotePairingRoomState =
	| 'active'
	| 'consumed'
	| 'expired'
	| 'locked'
	| 'rotated';

export interface RemotePairingStoreOptions {
	readonly serverId: ProtocolId;
	readonly sessionOrigin: string;
	readonly now?: () => number;
	readonly maxRooms?: number;
	readonly maxFailedAttempts?: number;
	readonly defaultLifetimeMs?: number;
	readonly maxLifetimeMs?: number;
	/** Injectable only for deterministic tests; production uses crypto.randomBytes. */
	readonly randomBytes?: (size: number) => Uint8Array;
}

export interface RemotePairingRoom {
	readonly roomId: ProtocolId;
	readonly serverId: ProtocolId;
	readonly sessionOrigin: string;
	readonly expiresAt: number;
	/** The caller places this one-time value in an in-memory URL fragment. */
	readonly secret: string;
}

export interface RemotePairingRoomMetadata {
	readonly roomId: ProtocolId;
	readonly serverId: ProtocolId;
	readonly sessionOrigin: string;
	readonly expiresAt: number;
	readonly state: RemotePairingRoomState;
	readonly failedAttempts: number;
}

export interface RemotePairingAttempt {
	readonly roomId: ProtocolId;
	readonly serverId: ProtocolId;
	readonly sessionOrigin: string;
	readonly secret: string;
}

export interface RemotePairingAdmission {
	readonly roomId: ProtocolId;
	readonly serverId: ProtocolId;
	readonly sessionOrigin: string;
	readonly consumedAt: number;
}

interface PairingRoomState {
	readonly roomId: ProtocolId;
	readonly serverId: ProtocolId;
	readonly sessionOrigin: string;
	readonly expiresAt: number;
	readonly secretDigest: string;
	state: RemotePairingRoomState;
	failedAttempts: number;
}

const DEFAULT_MAX_ROOMS = 16;
const DEFAULT_MAX_FAILED_ATTEMPTS = 5;
const DEFAULT_LIFETIME_MS = 5 * 60 * 1000;
const DEFAULT_MAX_LIFETIME_MS = 15 * 60 * 1000;
const SECRET_BYTES = 32;
/** Entropy collisions are extraordinarily unlikely in production, but an
 * injected/broken source must never replace an active one-time room. */
const MAX_GENERATION_ATTEMPTS = 3;

/**
 * Server-owned one-time pairing rooms. The raw fragment secret is returned
 * only at creation; the store retains a SHA-256 digest and exposes metadata
 * without credentials. WebRTC signaling and PIN/device-key verification stay
 * above this primitive.
 */
export class RemotePairingStore {
	private readonly now: () => number;
	private readonly maxRooms: number;
	private readonly maxFailedAttempts: number;
	private readonly defaultLifetimeMs: number;
	private readonly maxLifetimeMs: number;
	private readonly randomBytes: (size: number) => Uint8Array;
	private readonly rooms = new Map<ProtocolId, PairingRoomState>();

	constructor(private readonly options: RemotePairingStoreOptions) {
		if (!validId(options.serverId) || !validOrigin(options.sessionOrigin))
			throw new TypeError('pairing server identity/origin is invalid');
		this.now = options.now ?? (() => Date.now());
		this.maxRooms = positive(options.maxRooms ?? DEFAULT_MAX_ROOMS, 'maxRooms');
		this.maxFailedAttempts = positive(
			options.maxFailedAttempts ?? DEFAULT_MAX_FAILED_ATTEMPTS,
			'maxFailedAttempts',
		);
		this.defaultLifetimeMs = positive(
			options.defaultLifetimeMs ?? DEFAULT_LIFETIME_MS,
			'defaultLifetimeMs',
		);
		this.maxLifetimeMs = positive(
			options.maxLifetimeMs ?? DEFAULT_MAX_LIFETIME_MS,
			'maxLifetimeMs',
		);
		if (this.defaultLifetimeMs > this.maxLifetimeMs)
			throw new RangeError('defaultLifetimeMs cannot exceed maxLifetimeMs');
		this.randomBytes =
			options.randomBytes ?? ((size) => new Uint8Array(nodeRandomBytes(size)));
	}

	get serverId(): ProtocolId {
		return this.options.serverId;
	}
	get sessionOrigin(): string {
		return this.options.sessionOrigin;
	}

	/** Create a short-lived one-time room and return its secret to the caller. */
	create(expiresAt = this.now() + this.defaultLifetimeMs): RemotePairingRoom {
		this.validateExpiry(expiresAt);
		this.pruneTerminalRooms();
		if (this.rooms.size >= this.maxRooms)
			throw new Error('pairing room limit reached');
		const candidate = this.createUniqueCandidate();
		const state: PairingRoomState = {
			roomId: candidate.roomId,
			serverId: this.options.serverId,
			sessionOrigin: this.options.sessionOrigin,
			expiresAt,
			secretDigest: candidate.secretDigest,
			state: 'active',
			failedAttempts: 0,
		};
		this.rooms.set(candidate.roomId, state);
		return Object.freeze({
			roomId: candidate.roomId,
			serverId: state.serverId,
			sessionOrigin: state.sessionOrigin,
			expiresAt,
			secret: candidate.secret,
		});
	}

	/** Rotate pairing material without changing server identity or peers. */
	rotate(expiresAt = this.now() + this.defaultLifetimeMs): RemotePairingRoom {
		this.validateExpiry(expiresAt);
		this.expireRooms();
		for (const room of this.rooms.values())
			if (room.state === 'active') room.state = 'rotated';
		return this.create(expiresAt);
	}

	consume(attempt: RemotePairingAttempt): RemotePairingAdmission {
		this.expireRooms();
		if (
			!validId(attempt.roomId) ||
			attempt.serverId !== this.options.serverId ||
			attempt.sessionOrigin !== this.options.sessionOrigin
		)
			throw new Error('pairing room is unavailable');
		const room = this.rooms.get(attempt.roomId);
		if (room === undefined || room.state !== 'active')
			throw new Error('pairing room is unavailable');
		if (typeof attempt.secret !== 'string' || attempt.secret.length > 256)
			throw new Error('pairing secret is invalid');
		if (!constantTimeDigestEqual(room.secretDigest, digest(attempt.secret))) {
			room.failedAttempts += 1;
			if (room.failedAttempts >= this.maxFailedAttempts) room.state = 'locked';
			throw new Error('pairing secret is invalid');
		}
		room.state = 'consumed';
		return Object.freeze({
			roomId: room.roomId,
			serverId: room.serverId,
			sessionOrigin: room.sessionOrigin,
			consumedAt: this.now(),
		});
	}

	metadata(roomId: ProtocolId): RemotePairingRoomMetadata | undefined {
		this.expireRooms();
		const room = this.rooms.get(roomId);
		return room === undefined ? undefined : this.snapshot(room);
	}

	list(): readonly RemotePairingRoomMetadata[] {
		this.expireRooms();
		return Object.freeze(
			[...this.rooms.values()].map((room) => this.snapshot(room)),
		);
	}

	/** Reclaim expired and terminal room records without touching active rooms. */
	cleanup(): number {
		const before = this.rooms.size;
		this.pruneTerminalRooms();
		return before - this.rooms.size;
	}

	/** Disable active rooms without retaining their one-time secrets. */
	disable(): void {
		this.expireRooms();
		for (const room of this.rooms.values())
			if (room.state === 'active') room.state = 'expired';
	}

	private validateExpiry(expiresAt: number): void {
		const now = this.currentTime();
		if (now === undefined) throw new RangeError('pairing clock is invalid');
		if (
			!Number.isSafeInteger(expiresAt) ||
			expiresAt <= now ||
			expiresAt - now > this.maxLifetimeMs
		)
			throw new RangeError('pairing room expiry is invalid');
	}

	private expireRooms(): void {
		const now = this.currentTime();
		// A broken runtime clock must never extend a one-time credential's usable
		// lifetime. Terminally expire active rooms until an operator creates fresh
		// material after the clock has recovered.
		if (now === undefined) {
			for (const room of this.rooms.values())
				if (room.state === 'active') room.state = 'expired';
			return;
		}
		for (const room of this.rooms.values())
			if (room.state === 'active' && room.expiresAt <= now)
				room.state = 'expired';
	}

	private currentTime(): number | undefined {
		const now = this.now();
		return Number.isSafeInteger(now) && now >= 0 ? now : undefined;
	}

	private pruneTerminalRooms(): void {
		this.expireRooms();
		for (const [roomId, room] of this.rooms)
			if (room.state !== 'active') this.rooms.delete(roomId);
	}

	private snapshot(room: PairingRoomState): RemotePairingRoomMetadata {
		return Object.freeze({
			roomId: room.roomId,
			serverId: room.serverId,
			sessionOrigin: room.sessionOrigin,
			expiresAt: room.expiresAt,
			state: room.state,
			failedAttempts: room.failedAttempts,
		});
	}

	private entropy(size: number): Uint8Array {
		const bytes = this.randomBytes(size);
		if (!(bytes instanceof Uint8Array) || bytes.byteLength !== size)
			throw new TypeError(
				'pairing entropy generator returned an invalid length',
			);
		return bytes;
	}

	private createUniqueCandidate(): {
		readonly roomId: ProtocolId;
		readonly secret: string;
		readonly secretDigest: string;
	} {
		for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
			const roomId = `pair-${toToken(this.entropy(16))}`;
			const secret = toToken(this.entropy(SECRET_BYTES));
			const secretDigest = digest(secret);
			const roomIdInUse = this.rooms.has(roomId);
			const secretInUse = [...this.rooms.values()].some(
				(room) => room.secretDigest === secretDigest,
			);
			if (!roomIdInUse && !secretInUse) return { roomId, secret, secretDigest };
		}
		throw new Error('pairing entropy collision limit reached');
	}
}

function digest(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function constantTimeDigestEqual(expected: string, actual: string): boolean {
	const expectedBytes = Buffer.from(expected, 'hex');
	const actualBytes = Buffer.from(actual, 'hex');
	return (
		expectedBytes.length === actualBytes.length &&
		timingSafeEqual(expectedBytes, actualBytes)
	);
}

function toToken(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('base64url');
}

function validId(value: string): boolean {
	return (
		typeof value === 'string' &&
		/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
	);
}

function validOrigin(value: string): boolean {
	try {
		const url = new URL(value);
		const allowedProtocol =
			url.protocol === 'https:' ||
			(url.protocol === 'http:' &&
				(url.hostname === '127.0.0.1' ||
					url.hostname === 'localhost' ||
					url.hostname.endsWith('.localhost')));
		return (
			allowedProtocol &&
			!url.username &&
			!url.password &&
			!url.search &&
			!url.hash
		);
	} catch {
		return false;
	}
}

function positive(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new RangeError(`${name} must be positive`);
	return value;
}
