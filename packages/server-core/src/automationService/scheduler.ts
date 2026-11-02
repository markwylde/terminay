import {
	ScheduleEngine,
	type ScheduleClock,
} from '../scheduleEngine/scheduler.js';
import type { AutomationRepository } from './repository.js';
import type { AutomationRunLog } from './runLog.js';
import type {
	AutomationDefinition,
	AutomationRunController,
	AutomationRunEntry,
} from './types.js';

export { SCHEDULE_LATE_TOLERANCE_MS as AUTOMATION_SCHEDULE_LATE_TOLERANCE_MS } from '../scheduleEngine/scheduler.js';
export type AutomationSchedulerClock = ScheduleClock;

export interface AutomationSchedulerOptions {
	readonly repository: AutomationRepository;
	readonly runLog: AutomationRunLog;
	/** Resolved at fire time; absent executors are logged as skipped. */
	readonly controller: () => AutomationRunController | undefined;
	/** The server-owned engine. If omitted, this adapter owns a private one. */
	readonly engine?: ScheduleEngine;
	readonly clock?: Partial<AutomationSchedulerClock>;
	readonly timeZone?: string;
	readonly lateToleranceMs?: number;
	readonly generateRunId?: () => string;
	readonly onError?: (error: unknown) => void;
}

/** Automation run policy on the server's shared schedule engine. */
export class AutomationScheduler {
	private readonly engine: ScheduleEngine;
	private readonly clock: Pick<ScheduleClock, 'now'>;
	private readonly generateRunId: () => string;
	private readonly inFlight = new Map<string, string>();
	private started = false;
	private stopped = false;
	private unregister: (() => void) | undefined;
	private unsubscribeRunLog: (() => void) | undefined;

	constructor(private readonly options: AutomationSchedulerOptions) {
		this.engine = options.engine ?? new ScheduleEngine(options);
		this.clock = { now: options.clock?.now ?? Date.now };
		this.generateRunId = options.generateRunId ?? (() => crypto.randomUUID());
	}

	async start(): Promise<void> {
		if (this.started || this.stopped) return;
		this.started = true;
		await this.options.repository.load();
		await this.options.runLog.load();
		if (this.stopped) return;
		this.unsubscribeRunLog = this.options.runLog.subscribe((change) => {
			if (change.type === 'run') this.observeRun(change.run);
		});
		this.unregister = await this.engine.registerSource('automations', {
			schedules: () =>
				this.options.repository.state.automations.flatMap((automation) =>
					automation.trigger.kind !== 'schedule'
						? []
						: [
								{
									id: automation.id,
									enabled: automation.enabled,
									evaluatedThrough: automation.evaluatedThrough,
									schedule: {
										kind: 'cron' as const,
										cron: automation.trigger.cron,
									},
								},
							],
				),
			subscribe: (listener) => this.options.repository.subscribe(listener),
			recordMissed: (id, count, latest) =>
				this.options.runLog
					.recordMissed(id, count, latest)
					.then(() => undefined),
			markEvaluated: (id, through) =>
				this.options.repository.markEvaluated(id, through),
			onDue: async (id, firedAt) => {
				const automation = this.options.repository.state.automations.find(
					(candidate) => candidate.id === id,
				);
				if (automation?.enabled && automation.trigger.kind === 'schedule')
					await this.runOccurrence(automation, firedAt);
			},
			disableOnce: async () => {
				throw new Error('Automations only register cron schedules');
			},
		});
		if (this.stopped) this.unregister();
	}

	stop(): void {
		this.stopped = true;
		this.unregister?.();
		this.unsubscribeRunLog?.();
		if (this.options.engine === undefined) this.engine.stop();
	}

	idle(): Promise<void> {
		return this.engine.idle();
	}
	wake(): Promise<void> {
		return this.engine.wake();
	}
	nextDueAt(automationId: string): number | undefined {
		return this.engine.nextDueAt('automations', automationId);
	}
	get armedFor(): number | undefined {
		return this.engine.armedFor;
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
}
