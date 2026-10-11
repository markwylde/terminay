import { randomUUID } from 'node:crypto';
import {
	type ActivityNotificationKind,
	MAX_NOTIFICATION_BODY_CHARS,
	MAX_NOTIFICATION_TITLE_CHARS,
	MAX_SENT_NOTIFICATIONS_PER_TERMINAL,
	NOTIFICATION_SETTLE_MS,
	type NotificationEvent,
	type NotificationEventType,
	type NotificationListener,
	type NotificationOwner,
	type NotificationRecord,
	type NotificationReplay,
	type NotificationSnapshot,
	type SentNotificationText,
} from './types.js';

const DEFAULT_MAX_EVENTS = 1024;
const DEFAULT_SEND_RATE_LIMIT = 10;
const DEFAULT_SEND_RATE_WINDOW_MS = 10_000;

export interface NotificationManagerOptions {
	readonly now?: () => number;
	readonly settleMs?: number;
	readonly maxEvents?: number;
	readonly maxSentPerTerminal?: number;
	/** Sends one terminal may make within `sendRateWindowMs`. */
	readonly sendRateLimit?: number;
	readonly sendRateWindowMs?: number;
	readonly setTimeout?: (handler: () => void, milliseconds: number) => unknown;
	readonly clearTimeout?: (handle: unknown) => void;
	readonly createId?: () => string;
}

export class NotificationManagerError extends Error {
	readonly code: 'not_found' | 'limit' | 'rate_limited' | 'invalid';

	constructor(code: NotificationManagerError['code'], message: string) {
		super(message);
		this.name = 'NotificationManagerError';
		this.code = code;
	}
}

interface Entry {
	record: NotificationRecord;
	published: boolean;
	timer: unknown;
}

/**
 * The server's one holder of notifications (ADR-0061). Callers add, update,
 * and remove; they carry no timing. A record is pending until it has stayed
 * present for the settle period, and only published records are ever visible
 * to a consumer, so one removed while pending is never shown to anyone.
 */
export class NotificationManager {
	private readonly now: () => number;
	private readonly settleMs: number;
	private readonly maxEvents: number;
	private readonly maxSentPerTerminal: number;
	private readonly sendRateLimit: number;
	private readonly sendRateWindowMs: number;
	private readonly scheduleTimeout: (
		handler: () => void,
		milliseconds: number,
	) => unknown;
	private readonly cancelTimeout: (handle: unknown) => void;
	private readonly createId: () => string;
	private readonly entries = new Map<string, Entry>();
	private readonly activityIds = new Map<string, string>();
	private readonly sends = new Map<string, number[]>();
	private readonly events: NotificationEvent[] = [];
	private readonly listeners = new Set<NotificationListener>();
	private readonly sentListeners = new Set<(owner: NotificationOwner) => void>();
	private currentRevision = 0;
	private stopped = false;

	constructor(options: NotificationManagerOptions = {}) {
		this.now = options.now ?? (() => Date.now());
		this.settleMs = nonNegative(
			options.settleMs ?? NOTIFICATION_SETTLE_MS,
			'settleMs',
		);
		this.maxEvents = positive(
			options.maxEvents ?? DEFAULT_MAX_EVENTS,
			'maxEvents',
		);
		this.maxSentPerTerminal = positive(
			options.maxSentPerTerminal ?? MAX_SENT_NOTIFICATIONS_PER_TERMINAL,
			'maxSentPerTerminal',
		);
		this.sendRateLimit = positive(
			options.sendRateLimit ?? DEFAULT_SEND_RATE_LIMIT,
			'sendRateLimit',
		);
		this.sendRateWindowMs = positive(
			options.sendRateWindowMs ?? DEFAULT_SEND_RATE_WINDOW_MS,
			'sendRateWindowMs',
		);
		this.scheduleTimeout =
			options.setTimeout ??
			((handler, milliseconds) => {
				const timer = setTimeout(handler, milliseconds);
				timer.unref?.();
				return timer;
			});
		this.cancelTimeout =
			options.clearTimeout ??
			((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
		this.createId = options.createId ?? (() => `n-${randomUUID()}`);
	}

	get revision(): number {
		return this.currentRevision;
	}

	/** Pending records, each of which holds exactly one armed timer. */
	get pendingCount(): number {
		let count = 0;
		for (const entry of this.entries.values()) if (!entry.published) count += 1;
		return count;
	}

	/**
	 * Set, change, or clear the one notification terminal activity holds for a
	 * terminal. A change of kind keeps the record and its publication state.
	 */
	setActivity(
		owner: NotificationOwner,
		kind: ActivityNotificationKind | undefined,
		raisedAt = this.now(),
	): void {
		if (this.stopped) return;
		assertOwner(owner);
		const existingId = this.activityIds.get(owner.sessionId);
		const existing =
			existingId === undefined ? undefined : this.entries.get(existingId);
		if (kind === undefined) {
			if (existing !== undefined) this.remove(existing);
			return;
		}
		if (existing === undefined) {
			const record: NotificationRecord = Object.freeze({
				id: this.createId(),
				projectId: owner.projectId,
				sessionId: owner.sessionId,
				source: 'activity',
				kind,
				raisedAt,
			});
			this.activityIds.set(owner.sessionId, record.id);
			this.add(record);
			return;
		}
		if (
			existing.record.kind === kind &&
			existing.record.projectId === owner.projectId
		)
			return;
		this.update(
			existing,
			Object.freeze({
				...existing.record,
				projectId: owner.projectId,
				kind,
				raisedAt,
			}),
		);
	}

	/**
	 * Add a notification a process in the terminal sent, or replace the text of
	 * one it sent earlier. The text is stored as bounded plain text.
	 */
	send(
		owner: NotificationOwner,
		text: SentNotificationText,
		handle?: string,
	): NotificationRecord {
		assertOwner(owner);
		const title =
			text.title === undefined ? undefined : plainText(text.title);
		const body = plainText(text.body);
		if (body.length === 0)
			throw new NotificationManagerError('invalid', 'body is empty');
		if (codePoints(body) > MAX_NOTIFICATION_BODY_CHARS)
			throw new NotificationManagerError('invalid', 'body is too long');
		if (title !== undefined && codePoints(title) > MAX_NOTIFICATION_TITLE_CHARS)
			throw new NotificationManagerError('invalid', 'title is too long');
		const shown = title === undefined || title.length === 0 ? {} : { title };

		if (handle !== undefined) {
			const existing = this.sentEntry(owner.sessionId, handle);
			if (existing === undefined)
				throw new NotificationManagerError(
					'not_found',
					'this terminal sent no notification with that handle',
				);
			this.countSend(owner.sessionId);
			const { title: _title, ...rest } = existing.record;
			const next: NotificationRecord = Object.freeze({
				...rest,
				...shown,
				body,
			});
			this.update(existing, next);
			return next;
		}

		if (this.sentCount(owner.sessionId) >= this.maxSentPerTerminal)
			throw new NotificationManagerError(
				'limit',
				'this terminal holds the most notifications it may send',
			);
		this.countSend(owner.sessionId);
		const record: NotificationRecord = Object.freeze({
			id: this.createId(),
			projectId: owner.projectId,
			sessionId: owner.sessionId,
			source: 'message',
			kind: 'message',
			...shown,
			body,
			raisedAt: this.now(),
		});
		this.add(record);
		for (const listener of [...this.sentListeners]) {
			try {
				listener({ projectId: record.projectId, sessionId: record.sessionId });
			} catch {
				// An observer cannot undo an accepted send.
			}
		}
		return record;
	}

	/**
	 * Observe a process adding a notification. It names only the terminal, so a
	 * client that is already interacting with that terminal can acknowledge it
	 * within the settle period; the pending record itself stays unseen.
	 */
	onSent(listener: (owner: NotificationOwner) => void): () => void {
		if (typeof listener !== 'function')
			throw new TypeError('sent listener must be a function');
		this.sentListeners.add(listener);
		return () => {
			this.sentListeners.delete(listener);
		};
	}

	/** Remove one notification the terminal itself sent. */
	dismissSent(sessionId: string, handle: string): boolean {
		const entry = this.sentEntry(sessionId, handle);
		if (entry === undefined) return false;
		this.remove(entry);
		return true;
	}

	/** The record a client names, when its owner matches exactly. */
	find(
		id: string,
		owner: NotificationOwner,
	): NotificationRecord | undefined {
		const record = this.entries.get(id)?.record;
		return record !== undefined &&
			record.projectId === owner.projectId &&
			record.sessionId === owner.sessionId
			? record
			: undefined;
	}

	/** Remove one record by id, whatever added it. */
	removeById(id: string): boolean {
		const entry = this.entries.get(id);
		if (entry === undefined) return false;
		this.remove(entry);
		return true;
	}

	/** Remove what processes sent to a terminal: the user interacted with it. */
	removeSent(sessionId: string): void {
		for (const entry of [...this.entries.values()]) {
			if (
				entry.record.sessionId === sessionId &&
				entry.record.source === 'message'
			)
				this.remove(entry);
		}
	}

	/** Remove every record of a terminal: it closed. */
	removeSession(sessionId: string): void {
		for (const entry of [...this.entries.values()]) {
			if (entry.record.sessionId === sessionId) this.remove(entry);
		}
		this.sends.delete(sessionId);
	}

	/** Follow a terminal to the project its panel was moved to. */
	rehomeSession(sessionId: string, projectId: string): void {
		for (const entry of [...this.entries.values()]) {
			if (
				entry.record.sessionId !== sessionId ||
				entry.record.projectId === projectId
			)
				continue;
			// A project-scoped client must see the record leave one project and
			// arrive in the other, so the move is a removal and a publication.
			if (entry.published)
				this.commit('notification.removed', entry.record, false);
			entry.record = Object.freeze({ ...entry.record, projectId });
			if (entry.published)
				this.commit('notification.published', entry.record, true);
		}
	}

	snapshot(projectId?: string): NotificationSnapshot {
		const notifications: Record<string, NotificationRecord> = {};
		for (const [id, entry] of this.entries) {
			if (!entry.published) continue;
			if (projectId !== undefined && entry.record.projectId !== projectId)
				continue;
			notifications[id] = entry.record;
		}
		return Object.freeze({
			revision: this.currentRevision,
			cursor: String(this.currentRevision),
			notifications: Object.freeze(notifications),
		});
	}

	replay(afterRevision = 0, projectId?: string): NotificationReplay {
		if (!Number.isSafeInteger(afterRevision) || afterRevision < 0)
			throw new RangeError('afterRevision must be a non-negative safe integer');
		if (afterRevision > this.currentRevision)
			throw new RangeError('afterRevision is ahead of current revision');
		const oldest = this.events[0]?.revision ?? this.currentRevision + 1;
		if (afterRevision < oldest - 1) {
			return {
				kind: 'resync',
				events: [],
				snapshot: this.snapshot(projectId),
			};
		}
		return {
			kind: 'events',
			events: this.events.filter(
				(event) =>
					event.revision > afterRevision &&
					(projectId === undefined || event.projectId === projectId),
			),
		};
	}

	subscribe(listener: NotificationListener): () => void {
		if (typeof listener !== 'function')
			throw new TypeError('notification listener must be a function');
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	shutdown(): void {
		if (this.stopped) return;
		this.stopped = true;
		for (const entry of this.entries.values()) this.disarm(entry);
	}

	private add(record: NotificationRecord): void {
		const entry: Entry = { record, published: false, timer: undefined };
		this.entries.set(record.id, entry);
		if (this.stopped) return;
		// Armed by the addition and cancelled by the removal; nothing is sampled.
		entry.timer = this.scheduleTimeout(() => {
			entry.timer = undefined;
			if (this.stopped || this.entries.get(record.id) !== entry) return;
			entry.published = true;
			this.commit('notification.published', entry.record, true);
		}, this.settleMs);
	}

	private update(entry: Entry, record: NotificationRecord): void {
		entry.record = record;
		// A change keeps the publication state: a pending record keeps its
		// original deadline, and a published one is changed in place.
		if (entry.published) this.commit('notification.changed', record, true);
	}

	private remove(entry: Entry): void {
		const { record } = entry;
		this.disarm(entry);
		this.entries.delete(record.id);
		if (this.activityIds.get(record.sessionId) === record.id)
			this.activityIds.delete(record.sessionId);
		if (entry.published) this.commit('notification.removed', record, false);
	}

	private disarm(entry: Entry): void {
		if (entry.timer === undefined) return;
		this.cancelTimeout(entry.timer);
		entry.timer = undefined;
	}

	private commit(
		type: NotificationEventType,
		record: NotificationRecord,
		withRecord: boolean,
	): void {
		if (this.currentRevision === Number.MAX_SAFE_INTEGER)
			throw new RangeError('notification revision exhausted');
		this.currentRevision += 1;
		const event: NotificationEvent = Object.freeze({
			revision: this.currentRevision,
			cursor: String(this.currentRevision),
			type,
			id: record.id,
			projectId: record.projectId,
			sessionId: record.sessionId,
			...(withRecord ? { notification: record } : {}),
		});
		this.events.push(event);
		while (this.events.length > this.maxEvents) this.events.shift();
		const state = this.snapshot();
		for (const listener of [...this.listeners]) {
			try {
				listener(event, state);
			} catch {
				// Observers cannot roll back a committed revision.
			}
		}
	}

	private sentEntry(sessionId: string, handle: string): Entry | undefined {
		const entry = this.entries.get(handle);
		return entry !== undefined &&
			entry.record.sessionId === sessionId &&
			entry.record.source === 'message'
			? entry
			: undefined;
	}

	private sentCount(sessionId: string): number {
		let count = 0;
		for (const entry of this.entries.values()) {
			if (
				entry.record.sessionId === sessionId &&
				entry.record.source === 'message'
			)
				count += 1;
		}
		return count;
	}

	private countSend(sessionId: string): void {
		const at = this.now();
		const recent = (this.sends.get(sessionId) ?? []).filter(
			(sentAt) => at - sentAt < this.sendRateWindowMs,
		);
		if (recent.length >= this.sendRateLimit) {
			this.sends.set(sessionId, recent);
			throw new NotificationManagerError(
				'rate_limited',
				'this terminal is sending notifications too quickly',
			);
		}
		recent.push(at);
		this.sends.set(sessionId, recent);
	}
}

/**
 * Bounded plain text: escape sequences and control characters are removed and
 * runs of whitespace collapse, so the text can only ever be shown as text.
 */
export function plainText(value: string): string {
	return (
		value
			// OSC, DCS, APC, PM, and SOS strings, up to their terminator.
			// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
			.replace(/\u001b[\]PX^_][\s\S]*?(?:\u0007|\u001b\\|$)/gu, '')
			// CSI sequences.
			// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
			.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
			// Any other escape introducer with its one following byte.
			// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
			.replace(/\u001b[\s\S]?/gu, '')
			// Line breaks and tabs read as a space; other controls are dropped.
			.replace(LINE_BREAKS, ' ')
			// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
			.replace(/[\u0000-\u001f\u007f-\u009f]/gu, '')
			.replace(/ {2,}/gu, ' ')
			.trim()
	);
}

const LINE_BREAKS = new RegExp(
	`[\\t\\n\\r${String.fromCharCode(0x2028, 0x2029)}]+`,
	'gu',
);

function codePoints(value: string): number {
	return [...value].length;
}

function assertOwner(owner: NotificationOwner): void {
	if (
		typeof owner?.projectId !== 'string' ||
		owner.projectId.length === 0 ||
		typeof owner.sessionId !== 'string' ||
		owner.sessionId.length === 0
	)
		throw new TypeError('notification owner is invalid');
}

function positive(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new RangeError(`${name} must be a positive integer`);
	return value;
}

function nonNegative(value: number, name: string): number {
	if (!Number.isFinite(value) || value < 0)
		throw new RangeError(`${name} must be non-negative`);
	return value;
}
