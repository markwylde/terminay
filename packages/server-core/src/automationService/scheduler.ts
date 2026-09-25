import { type CronSchedule, nextOccurrence, parseCron } from '@terminay/cron';
import type { AutomationRepository } from './repository.js';
import type { AutomationRunLog } from './runLog.js';
import type {
	AutomationDefinition,
	AutomationRunController,
	AutomationRunEntry,
	AutomationState,
} from './types.js';

/** A timer that fires this much past its due time (the host slept, or the
 * clock jumped) counts the occurrences in between as missed, not due. */
export const AUTOMATION_SCHEDULE_LATE_TOLERANCE_MS = 60_000;
/** Occurrences counted into one missed record, however long the outage. */
const MAX_COUNTED_OCCURRENCES = 1_000_000;
/** `setTimeout` clamps longer delays to 1 ms; a farther due time re-arms. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export interface AutomationSchedulerClock {
	readonly now: () => number;
	readonly setTimeout: (handler: () => void, delayMs: number) => unknown;
	readonly clearTimeout: (handle: unknown) => void;
}

export interface AutomationSchedulerOptions {
	readonly repository: AutomationRepository;
	readonly runLog: AutomationRunLog;
	/** The run controller, resolved at fire time so a host can compose the
	 * executor after the scheduler. Absent: due runs are logged as skipped. */
	readonly controller: () => AutomationRunController | undefined;
	readonly clock?: Partial<AutomationSchedulerClock>;
	/** IANA zone schedules are evaluated in. Defaults to the host's zone. */
	readonly timeZone?: string;
	readonly lateToleranceMs?: number;
	readonly generateRunId?: () => string;
	readonly onError?: (error: unknown) => void;
}

interface ScheduleEntry {
	readonly cron: string;
	readonly schedule: CronSchedule;
	/** Epoch ms of the next occurrence, or undefined when it never fires. */
	nextDueAt: number | undefined;
}

/**
 * Server-owned schedule trigger. It keeps each enabled schedule's next due
 * time and arms exactly one timer to the earliest (ADR-0022: nothing wakes up
 * to check). It re-arms when definitions change, after every fire, and at
 * start. Occurrences that came due while the server was not running, or while
 * the host slept, are counted as missed and never run.
 */
export class AutomationScheduler {
	private readonly clock: AutomationSchedulerClock;
	private readonly lateToleranceMs: number;
	private readonly generateRunId: () => string;
	private readonly entries = new Map<string, ScheduleEntry>();
	/** Scheduled runs in progress, by automation. `pending` while the
	 * controller has not yet answered. */
	private readonly inFlight = new Map<string, string>();
	private timer: unknown;
	private timerDueAt: number | undefined;
	private started = false;
	private stopped = false;
	private firing: Promise<void> = Promise.resolve();
	private unsubscribeRepository: (() => void) | undefined;
	private unsubscribeRunLog: (() => void) | undefined;

	constructor(private readonly options: AutomationSchedulerOptions) {
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
		this.lateToleranceMs =
			options.lateToleranceMs ?? AUTOMATION_SCHEDULE_LATE_TOLERANCE_MS;
		this.generateRunId =
			options.generateRunId ?? (() => crypto.randomUUID());
	}

	/** Count occurrences missed while the server was down, then arm. */
	async start(): Promise<void> {
		if (this.started || this.stopped) return;
		this.started = true;
		const state = await this.options.repository.load();
		await this.options.runLog.load();
		if (this.stopped) return;
		this.unsubscribeRunLog = this.options.runLog.subscribe((change) => {
			if (change.type === 'run') this.observeRun(change.run);
		});
		const now = this.clock.now();
		for (const automation of state.automations) {
			if (!isEnabledSchedule(automation)) continue;
			const schedule = this.parse(automation.trigger.cron);
			if (schedule === undefined) continue;
			if (automation.evaluatedThrough < now) {
				const missed = this.occurrencesBetween(
					schedule,
					automation.evaluatedThrough,
					now,
				);
				await this.guard(async () => {
					if (missed.count > 0)
						await this.options.runLog.recordMissed(
							automation.id,
							missed.count,
							missed.latest,
						);
					await this.options.repository.markEvaluated(automation.id, now);
				});
			}
			this.entries.set(automation.id, {
				cron: automation.trigger.cron,
				schedule,
				nextDueAt: this.next(
					schedule,
					Math.max(now, automation.evaluatedThrough),
				),
			});
		}
		this.unsubscribeRepository = this.options.repository.subscribe((next) =>
			this.reconcile(next),
		);
		// A definition committed while start was counting is picked up here.
		this.reconcile(this.options.repository.state);
	}

	stop(): void {
		this.stopped = true;
		this.unsubscribeRepository?.();
		this.unsubscribeRunLog?.();
		this.disarm();
		this.entries.clear();
	}

	/** Resolves once any fire in progress has finished. For tests and
	 * orderly shutdown. */
	idle(): Promise<void> {
		return this.firing;
	}

	/** Re-evaluate against the current clock now, as if the timer had fired.
	 * Hosts may call this when the machine resumes from sleep or the wall
	 * clock changes; it is never called on an interval. */
	wake(): Promise<void> {
		if (!this.started || this.stopped) return Promise.resolve();
		this.disarm();
		return this.fire();
	}

	/** The next time an enabled schedule automation comes due. */
	nextDueAt(automationId: string): number | undefined {
		return this.entries.get(automationId)?.nextDueAt;
	}

	/** The time the single timer is currently armed for. */
	get armedFor(): number | undefined {
		return this.timerDueAt;
	}

	private reconcile(state: AutomationState): void {
		if (!this.started || this.stopped) return;
		const now = this.clock.now();
		const seen = new Set<string>();
		for (const automation of state.automations) {
			if (!isEnabledSchedule(automation)) continue;
			seen.add(automation.id);
			const existing = this.entries.get(automation.id);
			if (existing?.cron === automation.trigger.cron) continue;
			const schedule = this.parse(automation.trigger.cron);
			if (schedule === undefined) {
				this.entries.delete(automation.id);
				continue;
			}
			this.entries.set(automation.id, {
				cron: automation.trigger.cron,
				schedule,
				nextDueAt: this.next(
					schedule,
					Math.max(now, automation.evaluatedThrough),
				),
			});
		}
		for (const id of [...this.entries.keys()])
			if (!seen.has(id)) this.entries.delete(id);
		this.arm();
	}

	private arm(): void {
		this.disarm();
		if (this.stopped) return;
		let earliest: number | undefined;
		for (const entry of this.entries.values())
			if (
				entry.nextDueAt !== undefined &&
				(earliest === undefined || entry.nextDueAt < earliest)
			)
				earliest = entry.nextDueAt;
		if (earliest === undefined) return;
		const delay = Math.min(
			MAX_TIMER_DELAY_MS,
			Math.max(0, earliest - this.clock.now()),
		);
		this.timerDueAt = earliest;
		this.timer = this.clock.setTimeout(() => {
			this.timer = undefined;
			this.timerDueAt = undefined;
			void this.fire();
		}, delay);
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
			const state = this.options.repository.state;
			for (const [automationId, entry] of [...this.entries]) {
				if (entry.nextDueAt === undefined || entry.nextDueAt > now) continue;
				const automation = state.automations.find(
					(candidate) => candidate.id === automationId,
				);
				if (automation === undefined || !isEnabledSchedule(automation)) {
					this.entries.delete(automationId);
					continue;
				}
				// Every occurrence from the one armed for through now. Only the
				// latest can run, and only when the timer is not late for it; the
				// rest were slept through and are missed.
				const armedFor = entry.nextDueAt;
				const rest = this.occurrencesBetween(entry.schedule, armedFor, now);
				const latest = rest.count > 0 ? rest.latest : armedFor;
				const count = 1 + rest.count;
				const onTime = now - latest <= this.lateToleranceMs;
				const missedCount = onTime ? count - 1 : count;
				const missedLatest = onTime
					? count > 1
						? this.previousOccurrenceBefore(entry.schedule, armedFor, latest)
						: undefined
					: latest;
				entry.nextDueAt = this.next(entry.schedule, now);
				await this.guard(async () => {
					if (missedCount > 0 && missedLatest !== undefined)
						await this.options.runLog.recordMissed(
							automationId,
							missedCount,
							missedLatest,
						);
					await this.options.repository.markEvaluated(automationId, now);
					if (onTime) await this.runOccurrence(automation, latest);
				});
			}
			this.arm();
		};
		const next = this.firing.then(run, run);
		this.firing = next.catch(() => undefined);
		return next;
	}

	private async runOccurrence(
		automation: AutomationDefinition,
		firedAt: number,
	): Promise<void> {
		if (this.inFlight.has(automation.id)) {
			await this.recordSkipped(
				automation,
				firedAt,
				'previousRunStillRunning',
				'the previous scheduled run was still running',
			);
			return;
		}
		const controller = this.options.controller();
		if (controller === undefined) {
			await this.recordSkipped(
				automation,
				firedAt,
				'executorUnavailable',
				'no automation executor is available on this server',
			);
			return;
		}
		const pending = `pending:${this.generateRunId()}`;
		this.inFlight.set(automation.id, pending);
		let entry: AutomationRunEntry;
		try {
			entry = await controller.start({
				automation,
				startedBy: 'trigger',
				firedAt,
			});
		} catch (error) {
			if (this.inFlight.get(automation.id) === pending)
				this.inFlight.delete(automation.id);
			throw error;
		}
		if (this.inFlight.get(automation.id) !== pending) return;
		if (entry.status === 'running') {
			// The run may already have finished before start resolved.
			const current = this.options.runLog.get(entry.runId);
			if (current !== undefined && current.status !== 'running')
				this.inFlight.delete(automation.id);
			else this.inFlight.set(automation.id, entry.runId);
		} else this.inFlight.delete(automation.id);
	}

	private observeRun(run: AutomationRunEntry): void {
		if (run.status === 'running') return;
		if (this.inFlight.get(run.automationId) === run.runId)
			this.inFlight.delete(run.automationId);
	}

	private recordSkipped(
		automation: AutomationDefinition,
		firedAt: number,
		skipReason: NonNullable<AutomationRunEntry['skipReason']>,
		reason: string,
	): Promise<AutomationRunEntry> {
		const now = this.clock.now();
		return this.options.runLog.record({
			runId: this.generateRunId(),
			automationId: automation.id,
			triggerKind: 'schedule',
			firedAt,
			startedBy: 'trigger',
			status: 'finished',
			outcome: 'skipped',
			skipReason,
			reason,
			startedAt: now,
			finishedAt: now,
			durationMs: 0,
			suppressedEvents: 0,
		});
	}

	/** Occurrences strictly after `after` and at or before `through`. */
	private occurrencesBetween(
		schedule: CronSchedule,
		after: number,
		through: number,
	): { readonly count: number; readonly latest: number } {
		let count = 0;
		let latest = after;
		let cursor = after;
		while (count < MAX_COUNTED_OCCURRENCES) {
			const next = this.next(schedule, cursor);
			if (next === undefined || next > through) break;
			count += 1;
			latest = next;
			cursor = next;
		}
		return { count, latest };
	}

	/** The last occurrence in [from, before). */
	private previousOccurrenceBefore(
		schedule: CronSchedule,
		from: number,
		before: number,
	): number {
		let previous = from;
		let cursor = from;
		for (;;) {
			const next = this.next(schedule, cursor);
			if (next === undefined || next >= before) return previous;
			previous = next;
			cursor = next;
		}
	}

	private next(schedule: CronSchedule, after: number): number | undefined {
		return (
			nextOccurrence(schedule, new Date(after), this.options.timeZone)?.getTime() ??
			undefined
		);
	}

	private parse(cron: string): CronSchedule | undefined {
		try {
			return parseCron(cron);
		} catch (error) {
			this.report(error);
			return undefined;
		}
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
			// A failing reporter never stops the schedule.
		}
	}
}

function isEnabledSchedule(
	automation: AutomationDefinition,
): automation is AutomationDefinition & {
	readonly trigger: { readonly kind: 'schedule'; readonly cron: string };
} {
	return automation.enabled && automation.trigger.kind === 'schedule';
}
