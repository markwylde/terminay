import {
	createHash,
	createHmac,
	hkdfSync,
	randomBytes as nodeRandomBytes,
	timingSafeEqual,
} from 'node:crypto';
import type { ProtocolId } from '@terminay/protocol';

export type RemoteReconnectGrantLifetime =
	| '1h'
	| '24h'
	| '7d'
	| 'until-revoked';
export type RemoteReconnectGrantStatus =
	| 'none'
	| 'valid'
	| 'expired'
	| 'revoked';

export interface RemoteReconnectGrantStoreOptions {
	readonly serverId: ProtocolId;
	readonly sessionOrigin: string;
	readonly now?: () => number;
	readonly challengeTtlMs?: number;
	readonly maxChallenges?: number;
	readonly randomBytes?: (size: number) => Uint8Array;
	/** Server-bound persisted grant records. They contain only hashes/verifiers,
	 * never the reconnect grant secret itself. */
	readonly initialRecords?: readonly RemoteReconnectGrantRecord[];
}

export interface RemoteIssuedReconnectGrant {
	readonly grant: string;
	readonly handle: string;
	readonly serverId: ProtocolId;
	readonly sessionOrigin: string;
	readonly issuedAt: number;
	readonly expiresAt: number | null;
}

export interface RemoteReconnectChallenge {
	readonly action: 'reconnect';
	readonly attemptId: string;
	readonly clientNonce: string;
	readonly handle: string;
	readonly serverId: ProtocolId;
	readonly sessionOrigin: string;
	readonly issuedAt: number;
	readonly expiresAt: number;
	readonly protocolVersion: 'v1';
	readonly nonce: string;
}

export interface RemoteReconnectGrantSummary {
	readonly deviceId: ProtocolId;
	readonly handle: string | null;
	readonly expiresAt: number | null;
	readonly lastUsedAt: number | null;
	readonly status: RemoteReconnectGrantStatus;
}

export interface RemoteReconnectGrantRecord {
	readonly id: ProtocolId;
	readonly deviceId: ProtocolId;
	readonly handle: string;
	readonly serverId: ProtocolId;
	readonly sessionOrigin: string;
	readonly issuedAt: number;
	expiresAt: number | null;
	readonly grantHash: string;
	readonly proofVerifier: string;
	lastUsedAt: number | null;
	revokedAt: number | null;
}

interface PendingChallenge {
	readonly grantId: ProtocolId;
	readonly challenge: RemoteReconnectChallenge;
	readonly signingInput: string;
}

const LIFETIME_MS: Readonly<
	Record<Exclude<RemoteReconnectGrantLifetime, 'until-revoked'>, number>
> = {
	'1h': 60 * 60 * 1000,
	'24h': 24 * 60 * 60 * 1000,
	'7d': 7 * 24 * 60 * 60 * 1000,
};
const GRANT_BYTES = 32;
const HANDLE_BYTES = 32;
const CHALLENGE_BYTES = 24;
const DEFAULT_CHALLENGE_TTL_MS = 60 * 1000;
const DEFAULT_MAX_CHALLENGES = 64;
const DOMAIN = 'terminay\u0000v1\u0000remote-reconnect-challenge\u0000';

/**
 * Server-owned reconnect material. Only the issue operation returns a grant
 * secret; records retain a digest and a verifier derived from that secret.
 * Challenges are exact-origin and exact-server bound and are consumed only
 * after a valid proof, so a forged proof does not burn a usable challenge.
 *
 * Persistence is intentionally injected at the server boundary in a later
 * slice. This primitive keeps the protocol and security invariants testable
 * without allowing server-core to depend on a storage implementation.
 */
export class RemoteReconnectGrantStore {
	private readonly now: () => number;
	private readonly challengeTtlMs: number;
	private readonly maxChallenges: number;
	private readonly randomBytes: (size: number) => Uint8Array;
	private readonly grants = new Map<ProtocolId, RemoteReconnectGrantRecord>();
	private readonly challenges = new Map<ProtocolId, PendingChallenge>();
	private sequence = 0;

	constructor(private readonly options: RemoteReconnectGrantStoreOptions) {
		if (!validId(options.serverId) || !validOrigin(options.sessionOrigin))
			throw new TypeError('reconnect server identity/origin is invalid');
		this.now = options.now ?? (() => Date.now());
		this.challengeTtlMs = positive(
			options.challengeTtlMs ?? DEFAULT_CHALLENGE_TTL_MS,
			'challengeTtlMs',
		);
		this.maxChallenges = positive(
			options.maxChallenges ?? DEFAULT_MAX_CHALLENGES,
			'maxChallenges',
		);
		this.randomBytes =
			options.randomBytes ?? ((size) => new Uint8Array(nodeRandomBytes(size)));
		this.restore(options.initialRecords ?? []);
	}

	get serverId(): ProtocolId {
		return this.options.serverId;
	}

	get sessionOrigin(): string {
		return this.options.sessionOrigin;
	}

	issue(options: {
		readonly deviceId: ProtocolId;
		readonly lifetime?: RemoteReconnectGrantLifetime | string | null;
	}): RemoteIssuedReconnectGrant {
		if (!validId(options.deviceId))
			throw new TypeError('reconnect device identity is invalid');
		this.prune();
		const issuedAt = this.now();
		const grant = token(this.entropy(GRANT_BYTES));
		const handle = token(this.entropy(HANDLE_BYTES));
		const id = this.nextId('grant');
		const expiresAt = resolveExpiry(issuedAt, options.lifetime);
		const supersededGrantIds: ProtocolId[] = [];
		for (const record of this.grants.values()) {
			if (record.deviceId === options.deviceId && record.revokedAt === null) {
				record.revokedAt = issuedAt;
				supersededGrantIds.push(record.id);
			}
		}
		this.discardChallengesFor(supersededGrantIds);
		this.grants.set(id, {
			id,
			deviceId: options.deviceId,
			handle,
			serverId: this.options.serverId,
			sessionOrigin: this.options.sessionOrigin,
			issuedAt,
			expiresAt,
			grantHash: hash(grant),
			proofVerifier: deriveVerifier(grant),
			lastUsedAt: null,
			revokedAt: null,
		});
		return Object.freeze({
			grant,
			handle,
			serverId: this.options.serverId,
			sessionOrigin: this.options.sessionOrigin,
			issuedAt,
			expiresAt,
		});
	}

	rotate(options: {
		readonly handle: string;
		readonly origin: string;
		readonly deviceId?: ProtocolId;
		readonly lifetime?: RemoteReconnectGrantLifetime | string | null;
	}): RemoteIssuedReconnectGrant {
		const existing = this.requireByHandle(options.handle, options.origin);
		if (
			options.deviceId !== undefined &&
			options.deviceId !== existing.deviceId
		)
			throw new Error('reconnect grant device does not match');
		const issued = this.issue({
			deviceId: existing.deviceId,
			lifetime: options.lifetime,
		});
		return issued;
	}

	createChallenge(options: {
		readonly handle: string;
		readonly origin: string;
		readonly clientNonce: string;
	}): {
		readonly challenge: RemoteReconnectChallenge;
		readonly signingInput: string;
	} {
		const record = this.requireByHandle(options.handle, options.origin);
		if (!validNonce(options.clientNonce))
			throw new TypeError('reconnect client nonce is invalid');
		this.prune();
		if (this.challenges.size >= this.maxChallenges)
			throw new Error('reconnect challenge limit reached');
		const issuedAt = this.now();
		const challenge: RemoteReconnectChallenge = Object.freeze({
			action: 'reconnect',
			attemptId: this.nextId('attempt'),
			clientNonce: options.clientNonce,
			handle: record.handle,
			serverId: this.options.serverId,
			sessionOrigin: this.options.sessionOrigin,
			issuedAt,
			expiresAt: issuedAt + this.challengeTtlMs,
			protocolVersion: 'v1',
			nonce: token(this.entropy(CHALLENGE_BYTES)),
		});
		const signingInput = serializeRemoteReconnectChallenge(challenge);
		this.challenges.set(challenge.attemptId, {
			grantId: record.id,
			challenge,
			signingInput,
		});
		return Object.freeze({ challenge, signingInput });
	}

	/**
	 * Check that a reconnect handle still identifies a usable server-owned grant
	 * without allocating a challenge. Hosts use this before reserving their
	 * bounded admission ledger so arbitrary guessed handles cannot exhaust it.
	 */
	assertAvailable(handle: string, origin: string): void {
		this.requireByHandle(handle, origin);
	}

	verifyProof(options: {
		readonly attemptId: ProtocolId;
		readonly handle: string;
		readonly origin: string;
		readonly clientNonce: string;
		readonly proof: string;
		readonly verifyDeviceProof?: (
			deviceId: ProtocolId,
			signingInput: string,
		) => boolean;
	}): RemoteReconnectGrantRecord {
		this.prune();
		const pending = this.challenges.get(options.attemptId);
		if (pending === undefined)
			throw new Error('reconnect challenge is unavailable');
		const record = this.grants.get(pending.grantId);
		if (
			record === undefined ||
			!this.isUsable(record) ||
			pending.challenge.handle !== options.handle ||
			pending.challenge.sessionOrigin !== options.origin ||
			pending.challenge.serverId !== this.options.serverId ||
			pending.challenge.clientNonce !== options.clientNonce
		)
			throw new Error('reconnect proof does not match this grant or origin');
		const expected = createHmac(
			'sha256',
			Buffer.from(record.proofVerifier, 'base64url'),
		)
			.update(pending.signingInput)
			.digest('base64url');
		if (!equalToken(expected, options.proof))
			throw new Error('reconnect proof is invalid');
		if (options.verifyDeviceProof !== undefined) {
			let deviceProofValid: boolean;
			try {
				deviceProofValid = options.verifyDeviceProof(
					record.deviceId,
					pending.signingInput,
				);
			} catch {
				// A verifier outage is not an ordinary bad proof: retaining this
				// challenge would let a faulty verifier pin bounded challenge capacity.
				// Consume only this attempt; a fresh reconnect can retry once the
				// verifier has recovered.
				this.challenges.delete(options.attemptId);
				throw new Error('reconnect device proof verification failed');
			}
			if (!deviceProofValid)
				throw new Error('reconnect device proof is invalid');
		}
		this.challenges.delete(options.attemptId);
		record.lastUsedAt = this.now();
		return snapshotRecord(record);
	}

	revokeDevice(deviceId: ProtocolId): number {
		if (!validId(deviceId))
			throw new TypeError('reconnect device identity is invalid');
		const revokedAt = this.now();
		let count = 0;
		const revokedGrantIds: ProtocolId[] = [];
		for (const record of this.grants.values()) {
			if (record.deviceId === deviceId && record.revokedAt === null) {
				record.revokedAt = revokedAt;
				revokedGrantIds.push(record.id);
				count += 1;
			}
		}
		this.discardChallengesFor(revokedGrantIds);
		this.prune();
		return count;
	}

	summary(deviceId: ProtocolId): RemoteReconnectGrantSummary {
		if (!validId(deviceId))
			throw new TypeError('reconnect device identity is invalid');
		this.prune();
		const records = [...this.grants.values()]
			.filter((record) => record.deviceId === deviceId)
			.sort((left, right) => right.issuedAt - left.issuedAt);
		const record = records[0];
		if (record === undefined)
			return Object.freeze({
				deviceId,
				handle: null,
				expiresAt: null,
				lastUsedAt: null,
				status: 'none',
			});
		return Object.freeze({
			deviceId,
			handle: this.isUsable(record) ? record.handle : null,
			expiresAt: record.expiresAt,
			lastUsedAt: record.lastUsedAt,
			status: statusOf(record, this.now()),
		});
	}

	list(): readonly RemoteReconnectGrantRecord[] {
		this.prune();
		return Object.freeze([...this.grants.values()].map(snapshotRecord));
	}

	/** Reclaim only expired challenge state; grant records remain auditable. */
	cleanup(): number {
		const before = this.challenges.size;
		this.prune();
		return before - this.challenges.size;
	}

	private requireByHandle(
		handle: string,
		origin: string,
	): RemoteReconnectGrantRecord {
		if (!validToken(handle) || origin !== this.options.sessionOrigin)
			throw new Error('reconnect grant is unavailable for this origin');
		this.prune();
		const record = [...this.grants.values()].find(
			(candidate) => candidate.handle === handle,
		);
		if (record === undefined || !this.isUsable(record))
			throw new Error('reconnect grant is no longer valid');
		return record;
	}

	private isUsable(record: RemoteReconnectGrantRecord): boolean {
		return (
			record.revokedAt === null &&
			(record.expiresAt === null || record.expiresAt > this.now())
		);
	}

	private prune(): void {
		const now = this.now();
		for (const [id, pending] of this.challenges) {
			if (pending.challenge.expiresAt <= now) this.challenges.delete(id);
		}
	}

	/** A revoked or superseded grant can never verify its pending challenges. */
	private discardChallengesFor(grantIds: readonly ProtocolId[]): void {
		if (grantIds.length === 0) return;
		const discarded = new Set(grantIds);
		for (const [attemptId, pending] of this.challenges) {
			if (discarded.has(pending.grantId)) this.challenges.delete(attemptId);
		}
	}

	private entropy(size: number): Uint8Array {
		const bytes = this.randomBytes(size);
		if (!(bytes instanceof Uint8Array) || bytes.byteLength !== size)
			throw new TypeError(
				'reconnect entropy generator returned an invalid length',
			);
		return bytes;
	}

	private nextId(prefix: string): ProtocolId {
		let candidate: ProtocolId;
		do {
			this.sequence += 1;
			candidate = `${prefix}-${this.now().toString(36)}-${this.sequence.toString(36)}`;
		} while (this.grants.has(candidate) || this.challenges.has(candidate));
		return candidate;
	}

	private restore(records: readonly RemoteReconnectGrantRecord[]): void {
		const ids = new Set<string>();
		const handles = new Set<string>();
		for (const candidate of records) {
			if (
				!validPersistedRecord(
					candidate,
					this.options.serverId,
					this.options.sessionOrigin,
				) ||
				ids.has(candidate.id) ||
				handles.has(candidate.handle)
			)
				throw new TypeError('persisted reconnect grant record is invalid');
			ids.add(candidate.id);
			handles.add(candidate.handle);
			this.grants.set(candidate.id, { ...candidate });
		}
	}
}

export function serializeRemoteReconnectChallenge(
	challenge: RemoteReconnectChallenge,
): string {
	return `${DOMAIN}${JSON.stringify({
		action: challenge.action,
		attemptId: challenge.attemptId,
		clientNonce: challenge.clientNonce,
		expiresAt: challenge.expiresAt,
		handle: challenge.handle,
		issuedAt: challenge.issuedAt,
		nonce: challenge.nonce,
		origin: challenge.sessionOrigin,
		protocolVersion: challenge.protocolVersion,
		serverId: challenge.serverId,
	})}`;
}

export function createRemoteReconnectProof(
	grant: string,
	signingInput: string,
): string {
	if (!validToken(grant)) throw new TypeError('reconnect grant is invalid');
	return createHmac('sha256', Buffer.from(deriveVerifier(grant), 'base64url'))
		.update(signingInput)
		.digest('base64url');
}

function resolveExpiry(
	now: number,
	lifetime: RemoteReconnectGrantLifetime | string | null | undefined,
): number | null {
	if (lifetime === 'until-revoked') return null;
	const selected =
		lifetime === '1h' || lifetime === '7d' || lifetime === '24h'
			? lifetime
			: '24h';
	return now + LIFETIME_MS[selected];
}

function statusOf(
	record: RemoteReconnectGrantRecord,
	now: number,
): RemoteReconnectGrantStatus {
	if (record.revokedAt !== null) return 'revoked';
	if (record.expiresAt !== null && record.expiresAt <= now) return 'expired';
	return 'valid';
}

function snapshotRecord(
	record: RemoteReconnectGrantRecord,
): RemoteReconnectGrantRecord {
	return Object.freeze({ ...record });
}

function hash(value: string): string {
	return createHash('sha256').update(value).digest('base64url');
}

function deriveVerifier(grant: string): string {
	return Buffer.from(
		hkdfSync(
			'sha256',
			Buffer.from(grant, 'base64url'),
			new Uint8Array(0),
			'terminay remote v1 reconnect proof verifier',
			32,
		),
	).toString('base64url');
}

function equalToken(expected: string, actual: string): boolean {
	if (!validToken(actual)) return false;
	const expectedBytes = Buffer.from(expected, 'base64url');
	const actualBytes = Buffer.from(actual, 'base64url');
	return (
		expectedBytes.byteLength === actualBytes.byteLength &&
		timingSafeEqual(expectedBytes, actualBytes)
	);
}

function token(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('base64url');
}

function validPersistedRecord(
	value: RemoteReconnectGrantRecord,
	serverId: ProtocolId,
	sessionOrigin: string,
): boolean {
	return (
		value !== null &&
		typeof value === 'object' &&
		validId(value.id) &&
		validId(value.deviceId) &&
		validToken(value.handle) &&
		value.serverId === serverId &&
		value.sessionOrigin === sessionOrigin &&
		validTimestamp(value.issuedAt) &&
		validNullableTimestamp(value.expiresAt) &&
		validToken(value.grantHash) &&
		validToken(value.proofVerifier) &&
		validNullableTimestamp(value.lastUsedAt) &&
		validNullableTimestamp(value.revokedAt)
	);
}

function validTimestamp(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validNullableTimestamp(value: unknown): value is number | null {
	return value === null || validTimestamp(value);
}

function validToken(value: string): boolean {
	return typeof value === 'string' && /^[A-Za-z0-9_-]{16,512}$/u.test(value);
}

function validNonce(value: string): boolean {
	return typeof value === 'string' && /^[A-Za-z0-9_-]{8,256}$/u.test(value);
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
		const protocolOk =
			url.protocol === 'https:' ||
			(url.protocol === 'http:' &&
				(url.hostname === '127.0.0.1' ||
					url.hostname === 'localhost' ||
					url.hostname.endsWith('.localhost')));
		return (
			protocolOk && !url.username && !url.password && !url.search && !url.hash
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
