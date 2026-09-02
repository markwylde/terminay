import type { ProtocolId } from '@terminay/protocol';

export type RemoteAuditAction =
	| 'exposure-started'
	| 'exposure-rotated'
	| 'exposure-stopped'
	| 'pairing-created'
	| 'pairing-consumed'
	| 'pairing-rejected'
	| 'peer-connect-started'
	| 'peer-connected'
	| 'peer-connect-failed'
	| 'peer-closed'
	| 'device-registered'
	| 'device-revoked'
	| 'approval-requested'
	| 'approval-approved'
	| 'approval-denied'
	| 'approval-expired'
	| 'identity-reset'
	| 'cleanup';

/** Reasons are intentionally a closed set so relay failures never become a
 * covert channel for application data, credentials, or provider errors. */
export type RemoteAuditReason = 'invalid' | 'rate-limited' | 'transport';

export interface RemoteAuditEvent {
	readonly action: RemoteAuditAction;
	readonly occurredAt: number;
	readonly serverId: ProtocolId;
	readonly roomId?: ProtocolId;
	readonly peerId?: ProtocolId;
	readonly deviceId?: ProtocolId;
	readonly reason?: RemoteAuditReason;
}

export interface RemoteAuditLogOptions {
	readonly serverId: ProtocolId;
	readonly now?: () => number;
	readonly maxEvents?: number;
	/** The sink receives metadata only; secrets and application data are never passed. */
	readonly sink?: (event: RemoteAuditEvent) => void;
}

const DEFAULT_MAX_EVENTS = 512;

/** Bounded server-owned security history for the remote lifecycle. */
export class RemoteAuditLog {
	private readonly now: () => number;
	private readonly maxEvents: number;
	private readonly sink: ((event: RemoteAuditEvent) => void) | undefined;
	private readonly events: RemoteAuditEvent[] = [];
	/**
	 * Audit timestamps are observability metadata.  They must remain safe for
	 * JSON sinks and duration/ordering consumers even when an injected runtime
	 * clock is faulty or its wall clock moves backwards.
	 */
	private lastOccurredAt = 0;

	constructor(private readonly options: RemoteAuditLogOptions) {
		this.now = options.now ?? (() => Date.now());
		this.maxEvents = positive(
			options.maxEvents ?? DEFAULT_MAX_EVENTS,
			'maxEvents',
		);
		this.sink = options.sink;
	}

	record(
		event: Omit<RemoteAuditEvent, 'occurredAt' | 'serverId'>,
	): RemoteAuditEvent {
		assertAction(event.action);
		const normalized = Object.freeze({
			action: event.action,
			occurredAt: this.nextOccurredAt(),
			serverId: this.options.serverId,
			...(safeId(event.roomId) === undefined
				? {}
				: { roomId: safeId(event.roomId) }),
			...(safeId(event.peerId) === undefined
				? {}
				: { peerId: safeId(event.peerId) }),
			...(safeId(event.deviceId) === undefined
				? {}
				: { deviceId: safeId(event.deviceId) }),
			...(safeReason(event.reason) === undefined
				? {}
				: { reason: safeReason(event.reason) }),
		});
		this.events.push(normalized);
		if (this.events.length > this.maxEvents)
			this.events.splice(0, this.events.length - this.maxEvents);
		try {
			this.sink?.(normalized);
		} catch {
			/* Audit persistence must not take down the connection authority. */
		}
		return normalized;
	}

	list(limit = this.maxEvents): readonly RemoteAuditEvent[] {
		if (!Number.isSafeInteger(limit) || limit <= 0)
			throw new RangeError('audit list limit is invalid');
		return Object.freeze(
			this.events.slice(-Math.min(limit, this.maxEvents)).reverse(),
		);
	}

	get size(): number {
		return this.events.length;
	}

	private nextOccurredAt(): number {
		const candidate = this.now();
		if (!Number.isSafeInteger(candidate) || candidate < 0)
			return this.lastOccurredAt;
		this.lastOccurredAt = Math.max(this.lastOccurredAt, candidate);
		return this.lastOccurredAt;
	}
}

export interface RemoteRateLimiterOptions {
	readonly now?: () => number;
	readonly maxAttempts?: number;
	readonly windowMs?: number;
	readonly maxKeys?: number;
}

interface RateWindow {
	count: number;
	startedAt: number;
}

/** Fixed-window limiter for pairing and device-authentication attempts. */
export class RemoteRateLimiter {
	private readonly now: () => number;
	private readonly maxAttempts: number;
	private readonly windowMs: number;
	private readonly maxKeys: number;
	private readonly windows = new Map<string, RateWindow>();

	constructor(options: RemoteRateLimiterOptions = {}) {
		this.now = options.now ?? (() => Date.now());
		this.maxAttempts = positive(options.maxAttempts ?? 5, 'maxAttempts');
		this.windowMs = positive(options.windowMs ?? 60_000, 'windowMs');
		this.maxKeys = positive(options.maxKeys ?? 1_024, 'maxKeys');
	}

	consume(key: string): void {
		if (!validKey(key)) throw new TypeError('rate-limit key is invalid');
		this.prune();
		const now = this.now();
		const existing = this.windows.get(key);
		const window =
			existing !== undefined && existing.startedAt + this.windowMs > now
				? existing
				: { count: 0, startedAt: now };
		if (existing === undefined && this.windows.size >= this.maxKeys)
			throw new Error('remote rate-limit ledger is full');
		if (window.count >= this.maxAttempts)
			throw new Error('remote admission rate limit reached');
		window.count += 1;
		this.windows.set(key, window);
	}

	reset(key: string): void {
		this.windows.delete(key);
	}

	cleanup(): number {
		const before = this.windows.size;
		this.prune();
		return before - this.windows.size;
	}

	private prune(): void {
		const now = this.now();
		for (const [key, window] of this.windows)
			if (window.startedAt + this.windowMs <= now) this.windows.delete(key);
	}
}

function validKey(value: string): boolean {
	return (
		typeof value === 'string' &&
		/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
	);
}

const AUDIT_ACTIONS: ReadonlySet<RemoteAuditAction> = new Set([
	'exposure-started',
	'exposure-rotated',
	'exposure-stopped',
	'pairing-created',
	'pairing-consumed',
	'pairing-rejected',
	'peer-connect-started',
	'peer-connected',
	'peer-connect-failed',
	'peer-closed',
	'device-registered',
	'device-revoked',
	'approval-requested',
	'approval-approved',
	'approval-denied',
	'approval-expired',
	'identity-reset',
	'cleanup',
]);

function assertAction(value: unknown): asserts value is RemoteAuditAction {
	if (
		typeof value !== 'string' ||
		!AUDIT_ACTIONS.has(value as RemoteAuditAction)
	) {
		throw new TypeError('remote audit action is invalid');
	}
}

function safeId(value: unknown): ProtocolId | undefined {
	return typeof value === 'string' && validKey(value) ? value : undefined;
}

function safeReason(value: unknown): RemoteAuditReason | undefined {
	return value === 'invalid' ||
		value === 'rate-limited' ||
		value === 'transport'
		? value
		: undefined;
}

function positive(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new RangeError(`${name} must be positive`);
	return value;
}
