import { type CronSchedule, nextOccurrence, parseCron } from '@terminay/cron';

/** A later wake records slept-through occurrences instead of catching up. */
export const SCHEDULE_LATE_TOLERANCE_MS = 60_000;
export const MIN_SCHEDULE_INTERVAL_MS = 5 * 60_000;
const MAX_COUNTED_OCCURRENCES = 1_000_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export type Schedule =
	| { readonly kind: 'cron'; readonly cron: string }
	| {
			readonly kind: 'every';
			readonly intervalMs: number;
			readonly anchor: number;
	  }
	| { readonly kind: 'once'; readonly at: number };

export interface ScheduleDefinition {
	readonly id: string;
	readonly enabled: boolean;
	readonly schedule: Schedule;
	/** Durable progress, independent of the definition's edit revision. */
	readonly evaluatedThrough: number;
}

/** The caller loads its store before registering. A save/enable persists a new
 * interval anchor; the engine never derives it from startup or fire time. */
export interface ScheduleSource {
	readonly schedules: () => readonly ScheduleDefinition[];
	readonly subscribe: (listener: () => void) => () => void;
	readonly markEvaluated: (id: string, through: number) => Promise<void>;
	readonly recordMissed: (
		id: string,
		count: number,
		latest: number,
	) => Promise<void>;
	readonly onDue: (id: string, firedAt: number) => Promise<void>;
	readonly disableOnce: (id: string) => Promise<void>;
}

export interface ScheduleClock {
	readonly now: () => number;
	readonly setTimeout: (handler: () => void, delayMs: number) => unknown;
	readonly clearTimeout: (handle: unknown) => void;
}

export interface ScheduleEngineOptions {
	readonly clock?: Partial<ScheduleClock>;
	/** Defaults to the server's local time zone, as with automations. */
	readonly timeZone?: string;
	readonly lateToleranceMs?: number;
	readonly onError?: (error: unknown) => void;
}

type ParsedSchedule =
	| Exclude<Schedule, { kind: 'cron' }>
	| { readonly kind: 'cron'; readonly value: CronSchedule };
interface ScheduleEntry {
	readonly key: string;
	readonly schedule: ParsedSchedule;
	nextDueAt: number | undefined;
}
interface RegisteredSource {
	readonly source: ScheduleSource;
	readonly entries: Map<string, ScheduleEntry>;
	unsubscribe?: () => void;
}

/** Shared server scheduler: one one-shot deadline across all registered stores.
 * Sources own run policy and persistence. No interval wakes to check for work. */
export class ScheduleEngine {
	private readonly clock: ScheduleClock;
	private readonly sources = new Map<string, RegisteredSource>();
	private timer: unknown;
	private timerDueAt: number | undefined;
	private stopped = false;
	private firing: Promise<void> = Promise.resolve();

	constructor(private readonly options: ScheduleEngineOptions = {}) {
		this.clock = {
			now: options.clock?.now ?? Date.now,
			setTimeout:
				options.clock?.setTimeout ??
				((handler, delayMs) => {
					const timer = setTimeout(handler, delayMs);
					timer.unref?.();
					return timer;
				}),
			clearTimeout:
				options.clock?.clearTimeout ??
				((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)),
		};
	}

	/** Reconcile missed work on registration, including after a restart. Ids
	 * are local to their source, so different consumers can use the same id. */
	async registerSource(
		id: string,
		source: ScheduleSource,
	): Promise<() => void> {
		if (this.stopped) throw new Error('Schedule engine is stopped');
		if (this.sources.has(id))
			throw new Error(`Schedule source already registered: ${id}`);
		const registered: RegisteredSource = { source, entries: new Map() };
		this.sources.set(id, registered);
		const active = (): boolean =>
			!this.stopped && this.sources.get(id) === registered;
		const now = this.clock.now();
		for (const definition of source.schedules()) {
			if (!active()) break;
			if (!definition.enabled) continue;
			const entry = this.entry(definition, now);
			if (entry === undefined) continue;
			registered.entries.set(definition.id, entry);
			if (definition.evaluatedThrough < now) {
				const missed = this.occurrencesBetween(
					entry.schedule,
					definition.evaluatedThrough,
					now,
				);
				await this.guard(async () => {
					if (missed.count > 0)
						await source.recordMissed(
							definition.id,
							missed.count,
							missed.latest,
						);
					if (active()) await source.markEvaluated(definition.id, now);
				});
			}
			if (
				active() &&
				entry.schedule.kind === 'once' &&
				entry.schedule.at <= now
			)
				await this.guard(() => source.disableOnce(definition.id));
		}
		if (active()) {
			registered.unsubscribe = source.subscribe(() =>
				this.reconcile(registered),
			);
			// Catch a save that completed while missed occurrences were recorded.
			this.reconcile(registered);
		}
		return () => {
			if (this.sources.get(id) !== registered) return;
			registered.unsubscribe?.();
			this.sources.delete(id);
			registered.entries.clear();
			this.arm();
		};
	}

	stop(): void {
		this.stopped = true;
		for (const registered of this.sources.values()) registered.unsubscribe?.();
		this.sources.clear();
		this.disarm();
	}

	idle(): Promise<void> {
		return this.firing;
	}

	/** Host resume/clock-change hook; never invoked by a polling timer. */
	wake(): Promise<void> {
		if (this.stopped) return Promise.resolve();
		this.disarm();
		return this.fire();
	}

	nextDueAt(sourceId: string, scheduleId: string): number | undefined {
		return this.sources.get(sourceId)?.entries.get(scheduleId)?.nextDueAt;
	}

	get armedFor(): number | undefined {
		return this.timerDueAt;
	}

	private entry(
		definition: ScheduleDefinition,
		now: number,
	): ScheduleEntry | undefined {
		try {
			const schedule = parseSchedule(definition.schedule);
			return {
				key: scheduleKey(definition.schedule),
				schedule,
				nextDueAt: this.next(
					schedule,
					Math.max(now, definition.evaluatedThrough),
				),
			};
		} catch (error) {
			this.report(error);
			return undefined;
		}
	}

	private reconcile(registered: RegisteredSource): void {
		if (this.stopped) return;
		const now = this.clock.now();
		const seen = new Set<string>();
		for (const definition of registered.source.schedules()) {
			if (!definition.enabled) continue;
			seen.add(definition.id);
			if (
				registered.entries.get(definition.id)?.key ===
				scheduleKey(definition.schedule)
			)
				continue;
			const entry = this.entry(definition, now);
			if (entry === undefined) registered.entries.delete(definition.id);
			else registered.entries.set(definition.id, entry);
		}
		for (const id of registered.entries.keys())
			if (!seen.has(id)) registered.entries.delete(id);
		this.arm();
	}

	private arm(): void {
		this.disarm();
		if (this.stopped) return;
		let earliest: number | undefined;
		for (const { entries } of this.sources.values())
			for (const entry of entries.values())
				if (
					entry.nextDueAt !== undefined &&
					(earliest === undefined || entry.nextDueAt < earliest)
				)
					earliest = entry.nextDueAt;
		if (earliest === undefined) return;
		this.timerDueAt = earliest;
		this.timer = this.clock.setTimeout(
			() => {
				this.timer = undefined;
				this.timerDueAt = undefined;
				void this.fire();
			},
			Math.min(MAX_TIMER_DELAY_MS, Math.max(0, earliest - this.clock.now())),
		);
	}

	private disarm(): void {
		if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
		this.timer = undefined;
		this.timerDueAt = undefined;
	}

	private fire(): Promise<void> {
		const run = async (): Promise<void> => {
			if (this.stopped) return;
			const now = this.clock.now();
			for (const [sourceId, registered] of [...this.sources]) {
				const { source, entries } = registered;
				const active = (id: string, entry: ScheduleEntry): boolean =>
					!this.stopped &&
					this.sources.get(sourceId) === registered &&
					entries.get(id) === entry;
				for (const [id, entry] of [...entries]) {
					if (
						!active(id, entry) ||
						entry.nextDueAt === undefined ||
						entry.nextDueAt > now
					)
						continue;
					const armedFor = entry.nextDueAt;
					const rest = this.occurrencesBetween(entry.schedule, armedFor, now);
					const latest = rest.count > 0 ? rest.latest : armedFor;
					const count = 1 + rest.count;
					const onTime =
						now - latest <=
						(this.options.lateToleranceMs ?? SCHEDULE_LATE_TOLERANCE_MS);
					const missedCount = onTime ? count - 1 : count;
					const missedLatest = onTime
						? count > 1
							? this.previousOccurrenceBefore(entry.schedule, armedFor, latest)
							: undefined
						: latest;
					entry.nextDueAt = this.next(entry.schedule, now);
					await this.guard(async () => {
						if (missedCount > 0 && missedLatest !== undefined)
							await source.recordMissed(id, missedCount, missedLatest);
						if (active(id, entry)) await source.markEvaluated(id, now);
						if (active(id, entry) && onTime) await source.onDue(id, latest);
					});
					if (active(id, entry) && entry.schedule.kind === 'once')
						await this.guard(() => source.disableOnce(id));
				}
			}
			this.arm();
		};
		const next = this.firing.then(run, run);
		this.firing = next.catch(() => undefined);
		return next;
	}

	/** Occurrences strictly after `after` and at or before `through`. */
	private occurrencesBetween(
		schedule: ParsedSchedule,
		after: number,
		through: number,
	): { count: number; latest: number } {
		// Intervals can be counted without scanning an arbitrarily long outage.
		if (schedule.kind === 'every') {
			const first = this.next(schedule, after);
			if (first === undefined || first > through)
				return { count: 0, latest: after };
			const count = Math.floor((through - first) / schedule.intervalMs) + 1;
			return { count, latest: first + (count - 1) * schedule.intervalMs };
		}
		let count = 0;
		let latest = after;
		while (count < MAX_COUNTED_OCCURRENCES) {
			const next = this.next(schedule, latest);
			if (next === undefined || next > through) break;
			count += 1;
			latest = next;
		}
		return { count, latest };
	}

	private previousOccurrenceBefore(
		schedule: ParsedSchedule,
		from: number,
		before: number,
	): number {
		if (schedule.kind === 'every') return before - schedule.intervalMs;
		let previous = from;
		for (;;) {
			const next = this.next(schedule, previous);
			if (next === undefined || next >= before) return previous;
			previous = next;
		}
	}

	private next(schedule: ParsedSchedule, after: number): number | undefined {
		return nextParsedOccurrence(schedule, after, this.options.timeZone);
	}

	private async guard(operation: () => Promise<void>): Promise<void> {
		try {
			await operation();
		} catch (error) {
			this.report(error);
		}
	}

	private report(error: unknown): void {
		try {
			this.options.onError?.(error);
		} catch {
			/* A failing reporter never stops other sources. */
		}
	}
}

function scheduleKey(schedule: Schedule): string {
	switch (schedule.kind) {
		case 'cron':
			return `cron:${schedule.cron}`;
		case 'every':
			return `every:${schedule.intervalMs}:${schedule.anchor}`;
		case 'once':
			return `once:${schedule.at}`;
	}
}

function parseSchedule(schedule: Schedule): ParsedSchedule {
	if (schedule.kind === 'cron')
		return { kind: 'cron', value: parseCron(schedule.cron) };
	if (schedule.kind === 'every') {
		if (
			!Number.isSafeInteger(schedule.intervalMs) ||
			schedule.intervalMs < MIN_SCHEDULE_INTERVAL_MS
		)
			throw new Error('Schedule interval must be at least 5 minutes');
		if (
			!Number.isSafeInteger(schedule.anchor) ||
			!Number.isFinite(new Date(schedule.anchor).getTime())
		)
			throw new Error('Schedule anchor must be a valid epoch time');
	} else if (
		!Number.isSafeInteger(schedule.at) ||
		!Number.isFinite(new Date(schedule.at).getTime())
	)
		throw new Error('Once schedule must have a valid date and time');
	return schedule;
}

function nextParsedOccurrence(
	schedule: ParsedSchedule,
	after: number,
	timeZone?: string,
): number | undefined {
	if (schedule.kind === 'once')
		return schedule.at > after ? schedule.at : undefined;
	if (schedule.kind === 'every')
		return (
			schedule.anchor +
			Math.max(
				1,
				Math.floor((after - schedule.anchor) / schedule.intervalMs) + 1,
			) *
				schedule.intervalMs
		);
	return nextOccurrence(schedule.value, new Date(after), timeZone)?.getTime();
}
/** Preview uses the same parser, elapsed-time anchors and zone as execution. */
export function previewSchedule(
	schedule: Schedule,
	after: number,
	count = 5,
	timeZone?: string,
): number[] {
	if (!Number.isSafeInteger(count) || count < 1 || count > 1001)
		throw new Error('invalid preview count');
	const parsed = parseSchedule(schedule);
	const times: number[] = [];
	for (let n = 0; n < count; n++) {
		const next = nextParsedOccurrence(parsed, times.at(-1) ?? after, timeZone);
		if (next === undefined) break;
		times.push(next);
	}
	return times;
}
