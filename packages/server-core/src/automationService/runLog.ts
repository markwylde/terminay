import { AutomationServiceError } from './errors.js';
import { isEventKind } from './normalize.js';
import {
	AUTOMATION_OUTPUT_TAIL_BYTES,
	AUTOMATION_RUN_LOG_LIMIT,
	AUTOMATION_RUN_LOG_SCHEMA_VERSION,
	AUTOMATION_RUN_OPENED_SESSIONS_LIMIT,
	type AutomationMissedRecord,
	type AutomationRunEntry,
	type AutomationRunLogBackend,
	type AutomationRunLogChange,
	type AutomationRunLogState,
	type AutomationRunOutcome,
	type AutomationSkipReason,
	type AutomationSubject,
} from './types.js';

const OUTCOMES: ReadonlySet<string> = new Set<AutomationRunOutcome>([
	'succeeded',
	'failed',
	'timedOut',
	'stopped',
	'skipped',
]);
const SKIP_REASONS: ReadonlySet<string> = new Set<AutomationSkipReason>([
	'previousRunStillRunning',
	'subjectGone',
	'concurrencyLimit',
	'automationSpaceFull',
	'executorUnavailable',
]);
const MAX_REASON_LENGTH = 512;
const MAX_TITLE_LENGTH = 256;

export interface AutomationRunLogOptions {
	/** Runs kept per automation, oldest dropped first. */
	readonly limit?: number;
	readonly outputTailBytes?: number;
}

/** Bounded, server-owned log of automation runs and missed-schedule records.
 * Kept apart from the definitions so a busy automation never rewrites them. */
export class AutomationRunLog {
	private runs = new Map<string, AutomationRunEntry[]>();
	private missed = new Map<string, AutomationMissedRecord>();
	private loading: Promise<void> | undefined;
	private loaded = false;
	private queue: Promise<unknown> = Promise.resolve();
	private readonly listeners = new Set<
		(change: AutomationRunLogChange) => void
	>();
	readonly limit: number;
	readonly outputTailBytes: number;

	constructor(
		private readonly backend: AutomationRunLogBackend,
		options: AutomationRunLogOptions = {},
	) {
		this.limit = options.limit ?? AUTOMATION_RUN_LOG_LIMIT;
		this.outputTailBytes =
			options.outputTailBytes ?? AUTOMATION_OUTPUT_TAIL_BYTES;
	}

	async load(): Promise<AutomationRunLogState> {
		if (!this.loaded) {
			this.loading ??= this.loadFromBackend();
			await this.loading;
		}
		return this.snapshot();
	}

	snapshot(): AutomationRunLogState {
		this.assertLoaded();
		return {
			schemaVersion: AUTOMATION_RUN_LOG_SCHEMA_VERSION,
			runs: Object.fromEntries(
				[...this.runs].map(([id, entries]) => [id, structuredClone(entries)]),
			),
			missed: this.listMissed(),
		};
	}

	/** Runs newest first, for one automation or all of them. */
	list(automationId?: string): readonly AutomationRunEntry[] {
		this.assertLoaded();
		const entries =
			automationId === undefined
				? [...this.runs.values()].flat()
				: (this.runs.get(automationId) ?? []);
		return structuredClone(
			[...entries].sort(
				(left, right) =>
					right.startedAt - left.startedAt ||
					(right.runId < left.runId ? -1 : 1),
			),
		);
	}

	get(runId: string): AutomationRunEntry | undefined {
		this.assertLoaded();
		for (const entries of this.runs.values()) {
			const found = entries.find((entry) => entry.runId === runId);
			if (found !== undefined) return structuredClone(found);
		}
		return undefined;
	}

	latest(automationId: string): AutomationRunEntry | undefined {
		this.assertLoaded();
		const entries = this.runs.get(automationId);
		const last = entries?.[entries.length - 1];
		return last === undefined ? undefined : structuredClone(last);
	}

	listMissed(): readonly AutomationMissedRecord[] {
		this.assertLoaded();
		return structuredClone(
			[...this.missed.values()].sort(
				(left, right) => right.latestDueAt - left.latestDueAt,
			),
		);
	}

	subscribe(listener: (change: AutomationRunLogChange) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Insert a new run or replace the entry with the same run id. The output
	 * tail is bounded here, whatever the caller passed. */
	record(entry: AutomationRunEntry): Promise<AutomationRunEntry> {
		return this.mutate(() => {
			const normalized = this.normalizeEntry(entry);
			if (normalized === undefined)
				throw new AutomationServiceError(
					'invalid_automation',
					'automation run entry is invalid',
				);
			const entries = this.runs.get(normalized.automationId) ?? [];
			const index = entries.findIndex(
				(candidate) => candidate.runId === normalized.runId,
			);
			// Opened terminals only accumulate: a replacement written from an
			// older copy of the entry never forgets one recorded meanwhile.
			const merged =
				index === -1
					? normalized
					: mergeOpenedSessions(
							normalized,
							(entries[index] as AutomationRunEntry).openedSessions,
						);
			if (index === -1) entries.push(merged);
			else entries[index] = merged;
			while (entries.length > this.limit) entries.shift();
			this.runs.set(normalized.automationId, entries);
			return {
				result: structuredClone(merged),
				change: { type: 'run', run: structuredClone(merged) },
			};
		});
	}

	/** The run whose terminal is `sessionId`, or which opened it through MCP. */
	runOwningSession(sessionId: string): AutomationRunEntry | undefined {
		this.assertLoaded();
		for (const entries of this.runs.values())
			for (const entry of entries)
				if (
					entry.sessionId === sessionId ||
					entry.openedSessions?.includes(sessionId) === true
				)
					return structuredClone(entry);
		return undefined;
	}

	/** Record that a run opened a terminal through MCP. Atomic with every
	 * other write, so it is never lost to a concurrent replacement. */
	addOpenedSession(
		runId: string,
		sessionId: string,
	): Promise<AutomationRunEntry | undefined> {
		return this.mutate(() => {
			for (const entries of this.runs.values()) {
				const index = entries.findIndex((entry) => entry.runId === runId);
				if (index === -1) continue;
				const current = entries[index] as AutomationRunEntry;
				if (current.openedSessions?.includes(sessionId) === true)
					return { result: structuredClone(current), change: undefined };
				const next = withOpenedSessions(current, [sessionId]);
				entries[index] = next;
				return {
					result: structuredClone(next),
					change: { type: 'run', run: structuredClone(next) },
				};
			}
			return { result: undefined, change: undefined };
		});
	}

	/** Count a loop-guard suppression against the automation's latest run. */
	addSuppressed(
		automationId: string,
		count = 1,
	): Promise<AutomationRunEntry | undefined> {
		return this.mutate(() => {
			const entries = this.runs.get(automationId);
			const index = (entries?.length ?? 0) - 1;
			if (entries === undefined || index < 0)
				return { result: undefined, change: undefined };
			const current = entries[index] as AutomationRunEntry;
			const next = {
				...current,
				suppressedEvents: current.suppressedEvents + Math.max(0, count),
			};
			entries[index] = next;
			return {
				result: structuredClone(next),
				change: { type: 'run', run: structuredClone(next) },
			};
		});
	}

	/** Add missed occurrences to the automation's record. */
	recordMissed(
		automationId: string,
		missedCount: number,
		latestDueAt: number,
	): Promise<AutomationMissedRecord | undefined> {
		return this.mutate(() => {
			if (!Number.isSafeInteger(missedCount) || missedCount <= 0)
				return { result: undefined, change: undefined };
			const previous = this.missed.get(automationId);
			const next: AutomationMissedRecord = {
				automationId,
				missedCount: (previous?.missedCount ?? 0) + missedCount,
				latestDueAt: Math.max(previous?.latestDueAt ?? 0, latestDueAt),
			};
			this.missed.set(automationId, next);
			return {
				result: structuredClone(next),
				change: { type: 'missed', missed: this.listMissed() },
			};
		});
	}

	/** Clear one automation's missed record, or all of them. */
	dismissMissed(automationId?: string): Promise<boolean> {
		return this.mutate(() => {
			const changed =
				automationId === undefined
					? this.missed.size > 0
					: this.missed.has(automationId);
			if (automationId === undefined) this.missed.clear();
			else this.missed.delete(automationId);
			return {
				result: changed,
				change: changed
					? { type: 'missed', missed: this.listMissed() }
					: undefined,
			};
		});
	}

	/** Drop an automation's history and missed record. */
	forget(automationId: string): Promise<void> {
		return this.mutate(() => {
			const hadMissed = this.missed.delete(automationId);
			this.runs.delete(automationId);
			return {
				result: undefined,
				change: hadMissed
					? { type: 'missed', missed: this.listMissed() }
					: undefined,
			};
		});
	}

	/** Bound text to the last `outputTailBytes` bytes of UTF-8. */
	boundOutputTail(text: string): string {
		return boundTail(text, this.outputTailBytes);
	}

	private async loadFromBackend(): Promise<void> {
		const raw = await this.backend.load();
		const record =
			typeof raw === 'object' && raw !== null && !Array.isArray(raw)
				? (raw as Record<string, unknown>)
				: {};
		const runs = new Map<string, AutomationRunEntry[]>();
		const rawRuns =
			typeof record.runs === 'object' &&
			record.runs !== null &&
			!Array.isArray(record.runs)
				? (record.runs as Record<string, unknown>)
				: {};
		for (const [automationId, entries] of Object.entries(rawRuns)) {
			if (!Array.isArray(entries)) continue;
			const kept: AutomationRunEntry[] = [];
			for (const candidate of entries) {
				const entry = this.normalizeEntry(candidate);
				if (entry === undefined || entry.automationId !== automationId)
					continue;
				// A run that was in progress when the server stopped is over.
				kept.push(
					entry.status === 'running'
						? {
								...entry,
								status: 'finished',
								outcome: 'stopped',
								reason: 'the server stopped during the run',
							}
						: entry,
				);
			}
			if (kept.length > 0) runs.set(automationId, kept.slice(-this.limit));
		}
		const missed = new Map<string, AutomationMissedRecord>();
		if (Array.isArray(record.missed))
			for (const candidate of record.missed) {
				const value = asRecord(candidate);
				if (
					value !== undefined &&
					typeof value.automationId === 'string' &&
					value.automationId.length > 0 &&
					value.automationId.length <= 128 &&
					isCount(value.missedCount) &&
					(value.missedCount as number) > 0 &&
					isCount(value.latestDueAt)
				)
					missed.set(value.automationId, {
						automationId: value.automationId,
						missedCount: value.missedCount as number,
						latestDueAt: value.latestDueAt as number,
					});
			}
		this.runs = runs;
		this.missed = missed;
		this.loaded = true;
	}

	private normalizeEntry(value: unknown): AutomationRunEntry | undefined {
		const record = asRecord(value);
		if (
			record === undefined ||
			!isId(record.runId) ||
			!isId(record.automationId) ||
			(record.triggerKind !== 'schedule' && record.triggerKind !== 'event') ||
			(record.startedBy !== 'trigger' && record.startedBy !== 'user') ||
			(record.status !== 'running' && record.status !== 'finished') ||
			!isCount(record.firedAt) ||
			!isCount(record.startedAt)
		)
			return undefined;
		if (record.event !== undefined && !isEventKind(record.event))
			return undefined;
		if (record.outcome !== undefined && !OUTCOMES.has(String(record.outcome)))
			return undefined;
		if (
			record.skipReason !== undefined &&
			!SKIP_REASONS.has(String(record.skipReason))
		)
			return undefined;
		const subject =
			record.subject === undefined ? undefined : normalizeSubject(record.subject);
		if (record.subject !== undefined && subject === undefined) return undefined;
		const finishedAt = isCount(record.finishedAt)
			? record.finishedAt
			: undefined;
		const durationMs = isCount(record.durationMs)
			? record.durationMs
			: finishedAt !== undefined
				? Math.max(0, finishedAt - (record.startedAt as number))
				: undefined;
		return {
			runId: record.runId,
			automationId: record.automationId,
			triggerKind: record.triggerKind,
			...(record.event === undefined ? {} : { event: record.event }),
			firedAt: record.firedAt as number,
			startedBy: record.startedBy,
			...(subject === undefined ? {} : { subject }),
			status: record.status,
			...(record.outcome === undefined
				? {}
				: { outcome: record.outcome as AutomationRunOutcome }),
			...(record.skipReason === undefined
				? {}
				: { skipReason: record.skipReason as AutomationSkipReason }),
			...(typeof record.reason === 'string'
				? { reason: record.reason.slice(0, MAX_REASON_LENGTH) }
				: {}),
			...(typeof record.exitCode === 'number' &&
			Number.isSafeInteger(record.exitCode)
				? { exitCode: record.exitCode }
				: {}),
			startedAt: record.startedAt as number,
			...(finishedAt === undefined ? {} : { finishedAt }),
			...(durationMs === undefined ? {} : { durationMs }),
			...(isId(record.sessionId) ? { sessionId: record.sessionId } : {}),
			...openedSessionsField(record.openedSessions),
			...(typeof record.outputTail === 'string'
				? { outputTail: boundTail(record.outputTail, this.outputTailBytes) }
				: {}),
			suppressedEvents: isCount(record.suppressedEvents)
				? record.suppressedEvents
				: 0,
			...(isId(record.recordingId) ? { recordingId: record.recordingId } : {}),
		};
	}

	private async mutate<T>(
		operation: () => {
			readonly result: T;
			readonly change: AutomationRunLogChange | undefined;
		},
	): Promise<T> {
		const run = async () => {
			if (!this.loaded) await this.load();
			const { result, change } = operation();
			if (change !== undefined) {
				await this.backend.commit(this.snapshot());
				for (const listener of [...this.listeners]) {
					try {
						listener(structuredClone(change));
					} catch {
						// An observer failure never undoes a committed change.
					}
				}
			}
			return result;
		};
		const next = this.queue.then(run, run);
		this.queue = next.catch(() => undefined);
		return next;
	}

	private assertLoaded(): void {
		if (!this.loaded) throw new Error('automation run log is not loaded');
	}
}

function normalizeSubject(value: unknown): AutomationSubject | undefined {
	const record = asRecord(value);
	if (record === undefined) return undefined;
	const title = optionalTitle(record.title);
	switch (record.kind) {
		case 'terminal':
			if (
				!isId(record.serverId) ||
				!isId(record.projectId) ||
				!isId(record.sessionId)
			)
				return undefined;
			return {
				kind: 'terminal',
				serverId: record.serverId,
				projectId: record.projectId,
				sessionId: record.sessionId,
				...(isCount(record.sessionCreatedAt)
					? { sessionCreatedAt: record.sessionCreatedAt }
					: {}),
				...(title === undefined ? {} : { title }),
				...(optionalTitle(record.projectTitle) === undefined
					? {}
					: { projectTitle: optionalTitle(record.projectTitle) as string }),
			};
		case 'project':
			if (!isId(record.projectId)) return undefined;
			return {
				kind: 'project',
				projectId: record.projectId,
				...(title === undefined ? {} : { title }),
			};
		case 'device': {
			if (!isId(record.deviceId)) return undefined;
			const name = optionalTitle(record.name);
			return {
				kind: 'device',
				deviceId: record.deviceId,
				...(name === undefined ? {} : { name }),
			};
		}
		default:
			return undefined;
	}
}

/** The last `maxBytes` bytes of the UTF-8 encoding, never splitting a code
 * point. */
export function boundTail(text: string, maxBytes: number): string {
	const bytes = new TextEncoder().encode(text);
	if (bytes.byteLength <= maxBytes) return text;
	let start = bytes.byteLength - maxBytes;
	// Skip UTF-8 continuation bytes so the tail starts on a code point.
	while (start < bytes.byteLength && ((bytes[start] ?? 0) & 0xc0) === 0x80)
		start += 1;
	return new TextDecoder().decode(bytes.subarray(start));
}

/** Bounded, de-duplicated opened-session ids, oldest first. */
function openedSessionsField(value: unknown): {
	readonly openedSessions?: readonly string[];
} {
	if (!Array.isArray(value)) return {};
	const ids = [...new Set(value.filter(isId))].slice(
		-AUTOMATION_RUN_OPENED_SESSIONS_LIMIT,
	);
	return ids.length === 0 ? {} : { openedSessions: ids };
}

/** The entry with the opened sessions an earlier copy recorded kept first. */
function mergeOpenedSessions(
	entry: AutomationRunEntry,
	earlier: readonly string[] | undefined,
): AutomationRunEntry {
	if (earlier === undefined || earlier.length === 0) return entry;
	const { openedSessions: current, ...rest } = entry;
	return {
		...rest,
		...openedSessionsField([...earlier, ...(current ?? [])]),
	};
}

/** The entry with `added` appended to its opened sessions, bounded. */
function withOpenedSessions(
	entry: AutomationRunEntry,
	added: readonly string[] | undefined,
): AutomationRunEntry {
	if (added === undefined || added.length === 0) return entry;
	const { openedSessions: _previous, ...rest } = entry;
	return {
		...rest,
		...openedSessionsField([...(entry.openedSessions ?? []), ...added]),
	};
}

function optionalTitle(value: unknown): string | undefined {
	return typeof value === 'string' ? value.slice(0, MAX_TITLE_LENGTH) : undefined;
}

function isId(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
	);
}

function isCount(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
