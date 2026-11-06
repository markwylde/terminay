import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type {
	BotSourceTest,
	BotTrigger,
	BotTriggerDraft,
	BotTriggerFiring,
	BotUpcomingCursor,
	BotUpcomingPage,
} from '@terminay/protocol';
import {
	type EventFanout,
	previewSchedule,
	type ScheduleEngine,
	type TriggerEvent,
} from '../scheduleEngine/index.js';
import type { BotService } from './service.js';
import {
	BotSourceStore,
	evaluateObservation,
	initialCheckpoint,
	type Observation,
	type PendingSourceEvent,
} from './sourceState.js';
import {
	asSchedule,
	exact,
	integer,
	isObservation,
} from './sourceValidation.js';
import { botFailureCause } from './failure.js';
import { botProcessCount, classifyProcessFailure } from './processExhaustion.js';
import {
	BotBlockedError,
	BotError,
	type BotStore,
	object,
	text,
} from './store.js';
import {
	storedTrigger,
	triggerCondition,
	triggerId,
	triggerTime,
} from './triggerState.js';

/** Server-owned admission and schedules. Observations run only in bot containers. */
export class BotTriggers {
	readonly observations: BotSourceStore;
	private detach: (() => void)[] = [];
	private workers = new Map<
		string,
		{
			controller: AbortController;
			generation: string;
			task: Promise<void>;
			manual: boolean;
		}
	>();
	private tests = new Map<string, AbortController>();
	private retries = new Map<string, ReturnType<typeof setTimeout>>();
	private attempts = new Map<string, number>();
	private draining = new Set<string>();
	private checks = new Map<string, Promise<void>>();
	private started = false;
	private stopped = false;
	private timeZone?: string;
	constructor(
		private service: BotService,
		private store: BotStore,
		private now: () => number,
	) {
		this.observations = new BotSourceStore(
			join(service.sessions.root, '..', 'sources'),
		);
	}
	get timeZoneName(): string {
		return this.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
	}
	private find(id: string): BotTrigger | undefined {
		return this.store.triggers().find((t) => t.id === id);
	}
	private active(t: BotTrigger): boolean {
		return (
			!this.stopped && t.enabled && this.store.get(t.botId).enabled !== false
		);
	}
	private current(t: BotTrigger): boolean {
		const saved = this.find(t.id);
		return !!saved && saved.generation === t.generation && this.active(saved);
	}
	private changed(botId: string, id: string, type = 'trigger.updated'): void {
		this.service.messages.emitEvent(botId, type, id, this.store.revision);
		this.service.invalidate(botId);
	}
	private patch(id: string, patch: Partial<BotTrigger>): void {
		const t = this.find(id);
		if (t) {
			this.store.putTrigger({ ...t, ...patch });
			if (Object.keys(patch).some((k) => k !== 'evaluatedThrough'))
				this.changed(t.botId, id);
		}
	}
	async start(
		engine: ScheduleEngine,
		_fanout: EventFanout,
		timeZone?: string,
	): Promise<void> {
		if (this.started || this.stopped) return;
		this.started = true;
		this.timeZone = timeZone;
		for (const b of this.store.list())
			for (const f of this.store.firings(b.id)) {
				if (
					f.outcome === 'pending' &&
					!f.sessionId &&
					!this.observations.pending(b.id).some((e) => e.id === f.id)
				)
					this.store.putFiring({
						...f,
						outcome: 'skipped',
						reason: 'server restarted',
					});
			}
		const observe = ({ botId }: { botId: string }) => {
			this.syncFirings(botId);
			void this.drain(botId);
		};
		this.service.sessions.on('changed', observe);
		this.detach.push(() => this.service.sessions.off('changed', observe));
		const reconcile = () => this.reconcileSources();
		this.store.on('changed', reconcile);
		this.detach.push(() => this.store.off('changed', reconcile));
		// ADR-0028: outbound-bot-triggers records Mark's 2026-11-04 approval
		// for explicitly configured command/HTTP polls, minimum one minute.
		const unregister = await engine.registerSource('bots', {
			resume: () => this.resumeSources(),
			schedules: () =>
				this.store.triggers().flatMap((t) => {
					const schedule = asSchedule(t.condition);
					return schedule
						? [
								{
									id: t.id,
									enabled: this.active(t),
									schedule,
									evaluatedThrough: t.evaluatedThrough,
									minimumIntervalMs: 60000,
									lateToleranceMs: 1000,
								},
							]
						: [];
				}),
			subscribe: (listener) => {
				this.store.on('changed', listener);
				return () => this.store.off('changed', listener);
			},
			markEvaluated: async (id, through) =>
				this.patch(id, { evaluatedThrough: through }),
			recordMissed: async (id, count, latest) => {
				const t = this.find(id);
				if (t)
					this.patch(id, {
						missedCount: t.missedCount + count,
						missedLatest: latest,
					});
			},
			recoverMissed: async (id, after, through) => {
				const t = this.find(id);
				if (t) await this.recover(t, after, through);
			},
			onDue: async (id, at) => {
				const t = this.find(id);
				if (t && this.active(t)) {
					if (isObservation(t.condition)) {
						this.addRange(t, at - 1, at);
						void this.check(t);
					} else {
						this.acceptTime(t, at);
						void this.drain(t.botId);
					}
				}
			},
			disableOnce: async (id) => this.patch(id, { enabled: false }),
		});
		if (this.stopped) unregister();
		else this.detach.push(unregister);
		for (const t of this.store.triggers()) {
			if (
				this.active(t) &&
				(t.condition.kind === 'files' || t.condition.kind === 'sse') &&
				this.observations.checkpoint(t).health.lastAttempt !== null
			)
				this.health(t, {
					gap: 'Server restarted; only available source history can be recovered',
				});
		}
		this.reconcileSources();
		for (const b of this.store.list()) {
			void this.drain(b.id);
			for (const t of this.store.triggers(b.id))
				if (this.observations.checkpoint(t).recovery) void this.check(t);
		}
	}
	async idle(): Promise<void> {
		await Promise.allSettled([...this.workers.values()].map((w) => w.task));
		await Promise.allSettled([...this.checks.values()]);
	}
	stop(): void {
		this.stopped = true;
		for (const w of this.workers.values()) w.controller.abort();
		for (const c of this.tests.values()) c.abort();
		for (const timer of this.retries.values()) clearTimeout(timer);
		this.retries.clear();
		for (const d of this.detach.splice(0)) d();
	}
	private stopSource(id: string): void {
		this.workers.get(id)?.controller.abort();
		this.tests.get(id)?.abort();
		const timer = this.retries.get(id);
		if (timer) clearTimeout(timer);
		this.retries.delete(id);
	}
	availability(botId: string, enabled: boolean): void {
		for (const t of this.store.triggers(botId)) {
			this.stopSource(t.id);
			if (enabled) {
				this.patch(t.id, {
					evaluatedThrough: this.now(),
					condition:
						t.condition.kind === 'every' ||
						t.condition.kind === 'command' ||
						t.condition.kind === 'http'
							? { ...t.condition, anchor: this.now() }
							: t.condition,
				});
				this.observations.update(t, (c) => {
					c.resumeBaseline = t.condition.kind !== 'sse';
					if (t.condition.kind === 'sse') delete c.cursor;
					delete c.recovery;
				});
			}
		}
		this.reconcileSources();
		if (enabled) void this.drain(botId);
	}
	resumeSources(): void {
		for (const t of this.store.triggers())
			if (
				this.active(t) &&
				(t.condition.kind === 'files' || t.condition.kind === 'sse')
			) {
				this.health(t, {
					state: 'retrying',
					gap: 'Server/source interruption; only available history can be recovered',
					error: null,
				});
				this.stopSource(t.id);
				this.attempts.delete(t.id);
			}
		this.reconcileSources();
	}
	private reconcileSources(): void {
		if (!this.started || this.stopped) return;
		for (const [id, w] of this.workers) {
			const t = this.find(id);
			if (
				!t ||
				this.store.get(t.botId).enabled === false ||
				(!w.manual && !t.enabled) ||
				t.generation !== w.generation
			)
				w.controller.abort();
		}
		for (const t of this.store.triggers())
			if (
				this.active(t) &&
				(t.condition.kind === 'sse' || t.condition.kind === 'files') &&
				!this.workers.has(t.id) &&
				!this.retries.has(t.id) &&
				this.observations.checkpoint(t).health.state !== 'failed' &&
				this.observations.checkpoint(t).health.state !== 'blocked'
			)
				this.launch(t);
	}
	/**
	 * Patch health. A failed or blocked state starts a condition failure episode
	 * once; only a successful check, reset, disable or delete ends it. `report`
	 * is false when the caller reports the failure itself.
	 */
	private health(
		t: BotTrigger,
		patch: Partial<import('@terminay/protocol').BotSourceHealth>,
		report = true,
	): void {
		if (this.find(t.id)?.generation !== t.generation) return;
		let started: import('@terminay/protocol').BotSourceHealth | null = null;
		this.observations.update(t, (c) => {
			c.health = { ...c.health, ...patch, remembered: c.ids.length };
			if (
				(patch.state === 'failed' || patch.state === 'blocked') &&
				!c.failureEpisode
			) {
				c.failureEpisode = true;
				started = c.health;
			}
		});
		this.service.invalidate(t.botId);
		const health = started as import('@terminay/protocol').BotSourceHealth | null;
		if (health && report)
			void this.service.failureFollowUps.accept(t.botId, {
				kind: 'condition',
				sessionId: null,
				firingId: null,
				triggerId: t.id,
				triggerName: t.name,
				reason: health.error ?? 'The trigger condition check failed.',
				cause: health.cause ?? null,
			});
	}
	private launch(
		t: BotTrigger,
		test = false,
		observe?: (v: Observation) => Promise<void>,
	): Promise<void> {
		const controller = new AbortController();
		const source = t.condition;
		if (!isObservation(source)) return Promise.resolve();
		const runner = this.service.sourceRunner;
		const work = async () => {
			if (!runner)
				throw new BotError(
					'unavailable',
					'Container source runner unavailable',
				);
			if (source.kind === 'files' && t.recovery === 'ignore-gap')
				this.observations.update(t, (c) => {
					if (c.initialized) c.resumeBaseline = true;
				});
			this.health(t, {
				state: 'checking',
				lastAttempt: this.now(),
				error: null,
				cause: null,
				nextRetry: null,
			});
			await this.classified(t.botId, () =>
				runner.run(
				t.botId,
				source,
				{
					signal: controller.signal,
					cursor:
						t.recovery === 'ignore-gap'
							? undefined
							: this.observations.checkpoint(t).cursor,
					test,
				},
				async (value) => {
					if (controller.signal.aborted || (!test && !this.current(t))) return;
					if (observe) {
						await observe(value);
						return;
					}
					if (value.status && !value.snapshot) {
						this.health(t, {
							state:
								value.status === 'waiting'
									? 'waiting'
									: value.status === 'connected'
										? 'connected'
										: 'watching',
						});
						return;
					}
					await this.acceptObservation(t, value, this.now());
					this.attempts.delete(t.id);
				},
			));
		};
		const task = work()
			.catch((error) => {
				if (controller.signal.aborted || this.stopped || !this.find(t.id))
					return;
				const attempts = (this.attempts.get(t.id) ?? 0) + 1;
				this.attempts.set(t.id, attempts);
				const continuous = source.kind === 'sse' || source.kind === 'files';
				const blocked = error instanceof BotError && error.code === 'resource';
				const retry =
					continuous && !blocked && attempts <= 5 && this.current(t);
				const delay = Math.min(60000, 1000 * 2 ** (attempts - 1));
				this.health(t, {
					state: blocked ? 'blocked' : retry ? 'retrying' : 'failed',
					error:
						error instanceof Error
							? error.message.slice(0, 1024)
							: 'Source failed',
					cause: botFailureCause(error),
					nextRetry: retry ? this.now() + delay : null,
					gap: continuous
						? 'Observation gap; intermediate events may be unavailable'
						: null,
				});
				if (retry) {
					const timer = setTimeout(() => {
						this.retries.delete(t.id);
						this.reconcileSources();
					}, delay);
					timer.unref?.();
					this.retries.set(t.id, timer);
				}
				if (test) throw error;
			})
			.finally(() => {
				if (this.workers.get(t.id)?.controller === controller)
					this.workers.delete(t.id);
				queueMicrotask(() => this.reconcileSources());
			});
		this.workers.set(t.id, {
			controller,
			generation: t.generation ?? t.id,
			manual: test,
			task,
		});
		return task;
	}
	/** A source that cannot start a process is classified with engine evidence. */
	private async classified(
		botId: string,
		run: () => Promise<void>,
	): Promise<void> {
		try {
			await run();
		} catch (error) {
			const message = error instanceof Error ? error.message : '';
			const failure = await classifyProcessFailure(message, async () =>
				botProcessCount(
					await this.service.driverForRuntime(),
					`terminay-bot-${botId}`,
				),
			).catch(() => null);
			if (!failure) throw error;
			throw failure.cause
				? new BotBlockedError(failure.cause, failure.reason)
				: new BotError('unavailable', failure.reason);
		}
	}
	private async acceptObservation(
		t: BotTrigger,
		value: Observation,
		due: number,
		origin: 'trigger' | 'run-now' = 'trigger',
		recovery?: { after: number; through: number },
	): Promise<PendingSourceEvent[]> {
		if (!isObservation(t.condition)) return [];
		const worker = this.workers.get(t.id);
		// Redact bot credentials before durable diagnostics or selected payloads.
		const safe = JSON.parse(
			await this.service.redactMessage(t.botId, JSON.stringify(value)),
		) as Observation;
		if (
			worker?.controller.signal.aborted ||
			(origin === 'trigger' && !this.current(t)) ||
			this.find(t.id)?.generation !== t.generation ||
			this.store.get(t.botId).enabled === false
		)
			throw new BotError('conflict', 'Stale or disabled source');
		const previous = this.observations.checkpoint(t);

		const { checkpoint, events } = evaluateObservation(
			t.condition,
			previous,
			safe,
		);
		checkpoint.health = {
			...checkpoint.health,
			state:
				value.status === 'waiting'
					? 'waiting'
					: t.condition.kind === 'sse'
						? 'connected'
						: t.condition.kind === 'files'
							? 'watching'
							: 'healthy',
		};
		const accepted = this.observations.commit(
			t,
			checkpoint,
			events,
			this.now(),
			due,
			origin,
			recovery,
		);
		for (const event of accepted) this.recordPending(t, event);
		this.service.invalidate(t.botId);
		void this.drain(t.botId);
		return accepted;
	}
	private recordPending(t: BotTrigger, event: PendingSourceEvent): void {
		this.store.putFiring({
			id: event.id,
			botId: t.botId,
			triggerId: t.id,
			triggerName: event.triggerName,
			firedAt: event.dueAt,
			origin: event.origin,
			sessionId: null,
			outcome: 'pending',
			reason: null,
		});
	}
	private acceptTime(
		t: BotTrigger,
		due: number,
		recovery?: { after: number; through: number },
		origin: 'trigger' | 'run-now' = 'trigger',
	): PendingSourceEvent {
		const cp = this.observations.checkpoint(t);
		const event = this.observations.commit(
			t,
			cp,
			[{ kind: t.condition.kind }],
			this.now(),
			due,
			origin,
			recovery,
		)[0]!;
		this.recordPending(t, event);
		return event;
	}
	private addRange(t: BotTrigger, after: number, through: number): void {
		this.observations.update(t, (c) => {
			c.recovery = {
				after: Math.min(c.recovery?.after ?? after, after),
				through: Math.max(c.recovery?.through ?? through, through),
			};
		});
	}
	private async recover(
		t: BotTrigger,
		after: number,
		through: number,
	): Promise<void> {
		const schedule = asSchedule(t.condition);
		if (!schedule) return;
		const times = previewSchedule(
			schedule,
			after,
			1001,
			this.timeZone,
			60000,
		).filter((at) => at <= through);
		const count =
			schedule.kind === 'every'
				? Math.floor((through - (times[0] ?? through)) / schedule.intervalMs) +
					(times.length ? 1 : 0)
				: times.length;
		this.patch(t.id, {
			missedCount: t.missedCount + count,
			missedLatest: through,
		});
		if ((t.recovery ?? 'skip') === 'skip') return;
		this.addRange(t, after, through);
		void this.check(t);
	}
	private check(t: BotTrigger): Promise<void> {
		const existing = this.checks.get(t.id);
		if (existing) return existing;
		const task = (async () => {
			while (this.current(t)) {
				const cp = this.observations.checkpoint(t);
				const range = cp.recovery;
				if (!range) break;
				const schedule = asSchedule(t.condition);
				if (!schedule) break;
				const due =
					t.recovery === 'once'
						? range.through
						: previewSchedule(
								schedule,
								range.after,
								1,
								this.timeZone,
								60000,
							)[0];
				if (due === undefined || due > range.through) {
					this.observations.update(t, (c) => {
						delete c.recovery;
					});
					break;
				}
				if (isObservation(t.condition)) {
					if (this.workers.has(t.id)) break;
					if (
						[...this.workers.keys()].filter(
							(id) =>
								this.find(id)?.botId === t.botId &&
								['command', 'http'].includes(this.find(id)!.condition.kind),
						).length >= 4
					)
						break;
					await this.launch(t, false, async (value) => {
						if (this.current(t))
							await this.acceptObservation(t, value, due, 'trigger', range);
					});
				} else this.acceptTime(t, due, range);
				const failed = ['failed', 'blocked'].includes(
					this.observations.checkpoint(t).health.state,
				);
				if (failed) break;
				this.observations.update(t, (c) => {
					if (c.recovery) {
						if (t.recovery === 'once' && c.recovery.through > range.through)
							c.recovery.after = range.through;
						else if (t.recovery === 'once' || due >= c.recovery.through)
							delete c.recovery;
						else c.recovery.after = due;
					}
				});
				await this.drain(t.botId);
				if (this.observations.pending(t.botId).length >= 1000) break;
			}
		})()
			.catch((error) =>
				this.health(t, {
					state: 'blocked',
					error:
						error instanceof Error ? error.message : 'Source recovery failed',
				}),
			)
			.finally(() => {
				this.checks.delete(t.id);
				for (const other of this.store.triggers(t.botId)) {
					const cp = this.observations.checkpoint(other);
					if (
						other.id !== t.id &&
						this.active(other) &&
						cp.recovery &&
						!['failed', 'blocked'].includes(cp.health.state)
					)
						void this.check(other);
				}
			});
		this.checks.set(t.id, task);
		return task;
	}
	private async drain(botId: string): Promise<void> {
		if (
			this.draining.has(botId) ||
			this.stopped ||
			this.store.get(botId).enabled === false
		)
			return;
		this.draining.add(botId);
		try {
			const events = this.observations.pending(botId);
			const byTrigger = new Map<string, PendingSourceEvent[]>();
			for (const e of events) {
				const list = byTrigger.get(e.triggerId) ?? [];
				list.push(e);
				byTrigger.set(e.triggerId, list);
			}
			while (byTrigger.size) {
				for (const [id, list] of byTrigger) {
					if (this.service.queue.list(botId).length >= 20) return;
					const event = list.shift()!;
					if (!list.length) byTrigger.delete(id);
					const trigger = this.find(id);
					if (!trigger) {
						this.observations.delivered(botId, event.id);
						continue;
					}
					// Accepted once-trigger events remain valid after automatic disable.
					if (!this.store.firings(botId).some((f) => f.id === event.id))
						this.recordPending(trigger, event);
					const existing = this.service.sessions
						.list(botId)
						.find((s) => s.id === event.sessionId);
					if (
						existing &&
						(existing.state !== 'queued' ||
							this.service.queue
								.list(botId)
								.some((i) => i.sessionId === existing.id))
					) {
						if (existing.state !== 'queued')
							this.observations.delivered(botId, event.id);
						this.store.putFiring({
							id: event.id,
							botId,
							triggerId: id,
							triggerName: event.triggerName,
							firedAt: event.dueAt,
							origin: event.origin,
							sessionId: existing.id,
							outcome:
								existing.state === 'completed'
									? 'completed'
									: existing.state === 'queued'
										? 'pending'
										: existing.state === 'running'
											? 'running'
											: 'failed',
							reason: existing.reason,
						});
						continue;
					}
					const context = {
						eventId: event.id,
						source: trigger.condition.kind,
						triggerId: id,
						observedAt: event.observedAt,
						dueAt: event.dueAt,
						recovery: event.recovery ?? null,
						payload: event.payload,
					};
					try {
						const result = await this.service.send(
							botId,
							`${event.prompt}\n\n<untrusted-source-context>\n${JSON.stringify(context).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')}\n</untrusted-source-context>`,
							undefined,
							{
								kind: event.origin,
								triggerId: id,
								triggerName: event.triggerName,
								fireTime: event.dueAt,
							},
							() =>
								!this.stopped &&
								this.store.get(botId).enabled !== false &&
								!!this.find(id) &&
								this.observations.pending(botId).some((e) => e.id === event.id),
							event.sessionId,
						);
						if (this.service.sessions.get(result.sessionId).state !== 'queued')
							this.observations.delivered(botId, event.id);
						this.store.putFiring({
							id: event.id,
							botId,
							triggerId: id,
							triggerName: event.triggerName,
							firedAt: event.dueAt,
							origin: event.origin,
							sessionId: result.sessionId,
							outcome: 'pending',
							reason: null,
						});
					} catch (error) {
						if (
							!this.find(id) ||
							!this.observations.pending(botId).some((e) => e.id === event.id)
						)
							return;
						if (error instanceof BotError && error.code === 'resource') return;
						const reason =
							error instanceof Error &&
							error.message === 'bot restart reconciliation is not complete'
								? 'container engine unavailable'
								: error instanceof Error
									? error.message
									: 'agent not ready';
						this.store.putFiring({
							id: event.id,
							botId,
							triggerId: id,
							triggerName: event.triggerName,
							firedAt: event.dueAt,
							origin: event.origin,
							sessionId: null,
							outcome: 'failed',
							reason,
							cause: botFailureCause(error),
						});
						this.health(
							trigger,
							{ state: 'failed', error: reason, cause: botFailureCause(error) },
							false,
						);
						void this.service.failureFollowUps.accept(botId, {
							kind: 'firing',
							sessionId: null,
							firingId: event.id,
							triggerId: id,
							triggerName: event.triggerName,
							reason,
							cause: botFailureCause(error),
						});
						return;
					}
				}
			}
		} finally {
			this.draining.delete(botId);
			this.syncFirings(botId);
		}
	}
	list(botId: string): { revision: number; triggers: BotTrigger[] } {
		this.store.get(botId);
		return {
			revision: this.store.revision,
			triggers: this.store.triggers(botId).map((t) => ({
				...t,
				health: {
					...this.observations.checkpoint(t).health,
					nextCheck: asSchedule(t.condition)
						? (this.preview(t.condition)[0] ?? null)
						: null,
					...(!this.active(t) ? { state: 'disabled' as const } : {}),
				},
			})),
		};
	}
	preview(condition: unknown): number[] {
		const c = triggerCondition(condition, this.now());
		const schedule = asSchedule(c);
		return schedule
			? previewSchedule(schedule, this.now(), 5, this.timeZone, 60000)
			: [];
	}
	create(botId: string, draft: BotTriggerDraft, revision?: number): BotTrigger {
		return this.save(botId, undefined, draft, revision);
	}
	update(
		botId: string,
		id: string,
		draft: BotTriggerDraft,
		revision?: number,
	): BotTrigger {
		this.store.trigger(botId, triggerId(id));
		return this.save(botId, id, draft, revision);
	}
	async prepare(
		botId: string,
		id: string | undefined,
		draft: BotTriggerDraft,
		revision?: number,
	): Promise<BotTrigger> {
		this.store.get(botId);
		if (id) this.store.trigger(botId, triggerId(id));
		const condition = triggerCondition(draft.condition, this.now());
		const tid = id ?? randomBytes(12).toString('hex');
		const protectedSource =
			isObservation(condition) && this.service.sourceRunner
				? await this.service.sourceRunner.protect(botId, tid, condition)
				: condition;
		return this.save(
			botId,
			id,
			{ ...draft, condition: protectedSource },
			revision,
			tid,
		);
	}
	private save(
		botId: string,
		id: string | undefined,
		draft: BotTriggerDraft,
		revision?: number,
		newId?: string,
	): BotTrigger {
		this.store.get(botId);
		const d = object(draft);
		exact(d, ['name', 'enabled', 'prompt', 'condition', 'recovery']);
		if (typeof d.enabled !== 'boolean')
			throw new BotError('validation', 'enabled must be boolean');
		const previous = id ? this.store.trigger(botId, id) : undefined;
		let condition = triggerCondition(d.condition, this.now());
		if (condition.kind === 'event')
			throw new BotError(
				'validation',
				'Choose a container source; project events are unsupported',
			);
		const tid = id ?? newId ?? randomBytes(12).toString('hex');
		if (
			(condition.kind === 'http' || condition.kind === 'sse') &&
			Object.values(condition.headers ?? {}).some(
				(v) => !v.startsWith(`@vault:bot:${botId}:trigger:${tid}:header:`),
			)
		)
			throw new BotError(
				'validation',
				'Source headers must pass through the header vault',
			);
		const withoutAnchor = (c: BotTrigger['condition']) =>
			JSON.stringify({ ...c, ...('anchor' in c ? { anchor: 0 } : {}) });
		const same =
			previous &&
			withoutAnchor(previous.condition) === withoutAnchor(condition);
		if (same) condition = previous.condition;
		const t = storedTrigger({
			id: tid,
			botId,
			name: text(d.name, 256, 'trigger name'),
			enabled: d.enabled,
			prompt: text(d.prompt, 32768, 'prompt'),
			condition,
			recovery: d.recovery,
			generation: same ? previous.generation : randomBytes(12).toString('hex'),
			evaluatedThrough: same ? previous.evaluatedThrough : this.now(),
			missedCount: previous?.missedCount ?? 0,
			missedLatest: previous?.missedLatest ?? null,
		});
		const schedule = asSchedule(t.condition);
		if (
			schedule &&
			!previewSchedule(schedule, this.now(), 1, this.timeZone, 60000).length
		)
			throw new BotError('validation', 'schedule never matches');
		this.store.putTrigger(t, revision);
		if (!same) this.stopSource(t.id);
		if (!t.enabled) this.cancelPending(t);
		this.changed(botId, t.id, id ? 'trigger.updated' : 'trigger.created');
		this.reconcileSources();
		return t;
	}
	enable(botId: string, id: string, enabled: boolean, revision?: number): void {
		if (typeof enabled !== 'boolean')
			throw new BotError('validation', 'enabled must be boolean');
		const t = this.store.trigger(botId, triggerId(id));
		if (t.condition.kind === 'event' && enabled)
			throw new BotError('validation', 'Choose a supported source');
		this.stopSource(id);
		this.store.putTrigger(
			{
				...t,
				enabled,
				evaluatedThrough: this.now(),
				condition:
					enabled &&
					(t.condition.kind === 'every' ||
						t.condition.kind === 'command' ||
						t.condition.kind === 'http')
						? { ...t.condition, anchor: this.now() }
						: t.condition,
			},
			revision,
		);
		if (!enabled) {
			this.cancelPending(t);
			this.observations.update(t, (c) => {
				c.failureEpisode = false;
			});
		} else
			this.observations.update(t, (c) => {
				c.failureEpisode = false;
				c.resumeBaseline = t.condition.kind !== 'sse';
				if (t.condition.kind === 'sse') delete c.cursor;
				delete c.recovery;
				c.health = { ...c.health, state: 'disabled' };
			});
		this.changed(botId, id);
		this.reconcileSources();
	}
	private cancelPending(t: BotTrigger): void {
		this.stopSource(t.id);
		for (const e of this.observations
			.pending(t.botId)
			.filter((e) => e.triggerId === t.id))
			this.store.putFiring({
				id: e.id,
				botId: t.botId,
				triggerId: t.id,
				triggerName: e.triggerName,
				firedAt: e.dueAt,
				origin: e.origin,
				sessionId: null,
				outcome: 'skipped',
				reason: 'cancelled',
			});
		this.observations.cancel(t);
		this.service.queue.disableTrigger(t.botId, t.id);
	}
	remove(botId: string, id: string, revision?: number): void {
		const t = this.store.trigger(botId, triggerId(id));
		this.cancelPending(t);
		this.observations.cancel(t, true);
		this.store.removeTrigger(botId, id, revision);
		this.changed(botId, id, 'trigger.deleted');
	}
	removeBot(botId: string): void {
		for (const t of this.store.triggers(botId)) this.remove(botId, t.id);
		this.observations.removeBot(botId);
	}
	dismissMissed(botId: string, id: string): void {
		this.store.trigger(botId, triggerId(id));
		this.patch(id, { missedCount: 0, missedLatest: null });
	}
	firings(botId: string, id?: string): BotTriggerFiring[] {
		this.store.get(botId);
		if (id) this.store.trigger(botId, triggerId(id));
		return this.store
			.firings(botId)
			.filter((f) => !id || f.triggerId === id)
			.sort((a, b) => b.firedAt - a.firedAt);
	}
	upcoming(
		botId: string,
		from: number,
		through: number,
		limit = 1000,
		after?: BotUpcomingCursor,
	): BotUpcomingPage {
		this.store.get(botId);
		triggerTime(from);
		triggerTime(through);
		integer(limit, 1, 1000, 'upcoming limit');
		if (through < from || through - from > 366 * 86400000)
			throw new BotError('validation', 'Invalid upcoming range');
		if (after) {
			triggerTime(after.at);
			triggerId(after.triggerId);
		}
		const entries = this.store
			.triggers(botId)
			.flatMap((t) => {
				const schedule = asSchedule(t.condition);
				if (!schedule || !this.active(t)) return [];
				return previewSchedule(
					schedule,
					Math.max(
						0,
						Math.max(
							from,
							this.now() + 1,
							t.evaluatedThrough + 1,
							after?.at ?? 0,
						) -
							(after?.at ===
								Math.max(
									from,
									this.now() + 1,
									t.evaluatedThrough + 1,
									after?.at ?? 0,
								) && t.id <= after.triggerId
								? 0
								: 1),
					),
					limit + 1,
					this.timeZone,
					60000,
				)
					.filter(
						(at) =>
							at <= through &&
							(!after ||
								at > after.at ||
								(at === after.at && t.id > after.triggerId)),
					)
					.map((at) => ({ triggerId: t.id, triggerName: t.name, at }));
			})
			.sort((a, b) => a.at - b.at || a.triggerId.localeCompare(b.triggerId));
		const firings = entries.slice(0, limit),
			last = firings.at(-1);
		return {
			firings,
			next:
				entries.length > limit && last
					? { at: last.at, triggerId: last.triggerId }
					: null,
		};
	}
	async runNow(botId: string, id: string): Promise<BotTriggerFiring | null> {
		this.service.assertEnabled(botId);
		const t = this.store.trigger(botId, triggerId(id));
		if (t.condition.kind === 'event')
			throw new BotError('validation', 'Unsupported source');
		if (isObservation(t.condition)) {
			if (this.workers.has(t.id))
				throw new BotError(
					'resource',
					'Source is already running; use Test source',
				);
			const events: PendingSourceEvent[] = [];
			await this.launch(t, true, async (v) => {
				if (v.status && !v.snapshot) return;
				events.push(
					...(await this.acceptObservation(t, v, this.now(), 'run-now')),
				);
			});
			await this.drain(botId);
			return events[0]
				? (this.firings(botId, id).find((f) => f.id === events[0]!.id) ?? null)
				: null;
		}
		const e = this.acceptTime(t, this.now(), undefined, 'run-now');
		await this.drain(botId);
		return (
			this.store.firings(botId).find((f) => f.id === e.id) ?? {
				id: e.id,
				botId,
				triggerId: id,
				triggerName: e.triggerName,
				firedAt: e.dueAt,
				origin: 'run-now',
				sessionId: null,
				outcome: 'skipped',
				reason: 'cancelled',
			}
		);
	}
	async test(
		botId: string,
		condition: unknown,
		id?: string,
		signal?: AbortSignal,
	): Promise<BotSourceTest> {
		this.service.assertEnabled(botId);
		const tid = id ? triggerId(id) : randomBytes(12).toString('hex');
		if (id) this.store.trigger(botId, tid);
		const source = triggerCondition(condition, this.now());
		if (!isObservation(source))
			return {
				diagnostics: 'Time source: no command is executed.',
				events: [],
				wouldFire: 0,
			};
		const runner = this.service.sourceRunner;
		if (!runner) throw new BotError('unavailable', 'Source runner unavailable');
		const previous = id
			? this.observations.checkpoint(this.store.trigger(botId, tid))
			: undefined;
		const same =
			id &&
			JSON.stringify(this.store.trigger(botId, tid).condition, (k, v) =>
				k === 'anchor' ? 0 : v,
			) === JSON.stringify(source, (k, v) => (k === 'anchor' ? 0 : v));
		const cp = same && previous ? previous : initialCheckpoint(tid);
		const controller = new AbortController();
		this.tests.get(tid)?.abort();
		this.tests.set(tid, controller);
		const abort = () => controller.abort();
		signal?.addEventListener('abort', abort, { once: true });
		if (signal?.aborted) abort();
		const events: unknown[] = [];
		let diagnostics = 'No observation in the test window.';
		try {
			await runner.run(
				botId,
				source,
				{ signal: controller.signal, test: true, cursor: cp.cursor },
				async (value) => {
					if (controller.signal.aborted) return;
					if (value.status && !value.snapshot) {
						diagnostics = value.status;
						return;
					}
					const safe = JSON.parse(
						await this.service.redactMessage(botId, JSON.stringify(value)),
					) as Observation;
					const evaluated = evaluateObservation(source, cp, safe);
					Object.assign(cp, evaluated.checkpoint);
					events.push(...evaluated.events);
					diagnostics = JSON.stringify(safe).slice(0, 8192);
				},
			);
			return {
				diagnostics,
				events: events.slice(0, 25),
				wouldFire: events.length,
			};
		} finally {
			signal?.removeEventListener('abort', abort);
			if (this.tests.get(tid) === controller) this.tests.delete(tid);
		}
	}
	memory(
		botId: string,
		id: string,
		offset = 0,
	): { total: number; ids: string[]; next: number | null } {
		const t = this.store.trigger(botId, triggerId(id));
		integer(offset, 0, 100000, 'offset');
		const ids = this.observations.checkpoint(t).ids;
		return {
			total: ids.length,
			ids: ids.slice(offset, offset + 25),
			next: offset + 25 < ids.length ? offset + 25 : null,
		};
	}
	reset(botId: string, id: string, confirmed: boolean): void {
		if (!confirmed)
			throw new BotError(
				'validation',
				'Confirm memory reset; items may be processed again',
			);
		const t = this.store.trigger(botId, triggerId(id));
		this.stopSource(id);
		this.observations.reset(t);
		this.changed(botId, id);
		this.reconcileSources();
	}
	retry(botId: string, id: string): void {
		this.service.assertEnabled(botId);
		const t = this.store.trigger(botId, triggerId(id));
		this.attempts.delete(id);
		this.health(t, { state: 'disabled', error: null, nextRetry: null });
		this.stopSource(id);
		this.reconcileSources();
		void this.check(t);
		void this.drain(botId);
	}
	private syncing = false;
	private syncFirings(botId?: string): void {
		if (this.syncing) return;
		this.syncing = true;
		try {
			for (const b of this.store.list().filter((b) => !botId || b.id === botId))
				for (const f of this.store.firings(b.id)) {
					if (!f.sessionId || !['pending', 'running'].includes(f.outcome))
						continue;
					const s = this.service.sessions
						.list(b.id)
						.find((s) => s.id === f.sessionId);
					if (!s) continue;
					const outcome =
						s.firing === 'skipped'
							? 'skipped'
							: s.state === 'queued'
								? 'pending'
								: ['running', 'needs-you'].includes(s.state)
									? 'running'
									: s.state === 'completed'
										? 'completed'
										: 'failed';
					if (f.outcome !== outcome || f.reason !== s.reason)
						this.store.putFiring({ ...f, outcome, reason: s.reason });
				}
		} finally {
			this.syncing = false;
		}
	}
}
/** Explicit allowlist, bounded independently of the prompt. Never spread a source payload. */
export function eventBlock(
	event: TriggerEvent,
	firedAt?: number,
	trigger?: Pick<BotTrigger, 'id' | 'name'>,
): string {
	const bounded = (v: unknown) =>
		typeof v === 'string'
			? Buffer.from(v).subarray(0, 512).toString('utf8')
			: undefined;
	const subject = event.subject;
	const facts = {
		event: event.event,
		firedAt,
		triggerId: trigger?.id,
		triggerName: bounded(trigger?.name),
		subject: {
			kind: subject.kind,
			...(subject.kind === 'terminal'
				? {
						serverId: bounded(subject.serverId),
						projectId: bounded(subject.projectId),
						sessionId: bounded(subject.sessionId),
						sessionCreatedAt: subject.sessionCreatedAt,
						title: bounded(subject.title),
						projectTitle: bounded(subject.projectTitle),
					}
				: subject.kind === 'project'
					? {
							projectId: bounded(subject.projectId),
							title: bounded(subject.title),
						}
					: {
							deviceId: bounded(subject.deviceId),
							name: bounded(subject.name),
						}),
		},
		context: {
			agentProvider: bounded(event.context?.agentProvider),
			agentState: bounded(event.context?.agentState),
			agentOutcome: bounded(event.context?.agentOutcome),
			exitCode: event.context?.exitCode,
		},
	};
	return `\n\n<event-context>\n${JSON.stringify(facts)}\n</event-context>`;
}
