import { randomBytes } from 'node:crypto';
import type {
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
import { BotError, type BotStore, object, text } from './store.js';
import { triggerCondition, triggerId, triggerTime } from './triggerState.js';

/** Adapter policy only: the shared engine owns time, and BotService owns turns. */
export class BotTriggers {
	private readonly detach: (() => void)[] = [];
	private readonly pending = new Map<string, { cancelled: boolean }>();
	private timeZone?: string;
	private started = false;
	private stopped = false;
	constructor(
		private readonly service: BotService,
		private readonly store: BotStore,
		private readonly now: () => number,
	) {}
	async start(
		engine: ScheduleEngine,
		fanout: EventFanout,
		timeZone?: string,
	): Promise<void> {
		if (this.started || this.stopped) return;
		this.started = true;
		this.timeZone = timeZone;
		for (const bot of this.store.list())
			for (const f of this.store.firings(bot.id))
				if (f.outcome === 'pending' && !f.sessionId)
					this.store.putFiring({
						...f,
						outcome: 'skipped',
						reason: 'server restarted',
					});
		this.syncFirings();
		const observe = ({ botId }: { botId: string }) => this.syncFirings(botId);
		this.service.sessions.on('changed', observe);
		this.detach.push(() => this.service.sessions.off('changed', observe));
		const unregister = await engine.registerSource('bots', {
			schedules: () =>
				this.store.triggers().flatMap((t) =>
					t.condition.kind === 'event'
						? []
						: [
								{
									id: t.id,
									enabled: t.enabled,
									schedule: t.condition,
									evaluatedThrough: t.evaluatedThrough,
								},
							],
				),
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
						missedCount: Math.min(
							Number.MAX_SAFE_INTEGER,
							t.missedCount + count,
						),
						missedLatest: latest,
						evaluatedThrough: latest,
					});
			},
			onDue: async (id, at) => {
				const t = this.find(id);
				if (t?.enabled) await this.fire(t, at, 'trigger');
			},
			// Automatic completion must keep a once trigger's already queued firing.
			disableOnce: async (id) => this.patch(id, { enabled: false }),
		});
		if (this.stopped) {
			unregister();
			return;
		}
		this.detach.push(unregister);
		this.detach.push(
			fanout.registerSource('bots', {
				accepts: (event) =>
					this.store
						.triggers()
						.some(
							(t) =>
								t.enabled &&
								t.condition.kind === 'event' &&
								t.condition.event === event,
						),
				onEvent: async (event, at) => {
					await Promise.all(
						this.store
							.triggers()
							.filter(
								(t) =>
									t.enabled &&
									t.condition.kind === 'event' &&
									t.condition.event === event.event,
							)
							.map((t) => this.fire(t, at, 'trigger', event)),
					);
				},
			}),
		);
		fanout.start();
	}
	stop(): void {
		this.stopped = true;
		for (const token of this.pending.values()) token.cancelled = true;
		for (const detach of this.detach.splice(0)) detach();
	}
	private find(id: string): BotTrigger | undefined {
		return this.store.triggers().find((t) => t.id === id);
	}
	private patch(id: string, patch: Partial<BotTrigger>): void {
		const t = this.find(id);
		if (t) this.store.putTrigger({ ...t, ...patch });
	}
	list(botId: string): { revision: number; triggers: BotTrigger[] } {
		this.store.get(botId);
		return {
			revision: this.store.revision,
			triggers: this.store.triggers(botId),
		};
	}
	preview(condition: unknown): number[] {
		const c = triggerCondition(condition, this.now());
		return c.kind === 'event'
			? []
			: previewSchedule(c, this.now(), 5, this.timeZone);
	}
	create(
		botId: string,
		draft: BotTriggerDraft,
		expectedRevision?: number,
	): BotTrigger {
		return this.save(botId, undefined, draft, expectedRevision);
	}
	update(
		botId: string,
		id: string,
		draft: BotTriggerDraft,
		expectedRevision?: number,
	): BotTrigger {
		this.store.trigger(botId, triggerId(id));
		return this.save(botId, id, draft, expectedRevision);
	}
	private save(
		botId: string,
		id: string | undefined,
		draft: BotTriggerDraft,
		expectedRevision?: number,
	): BotTrigger {
		this.store.get(botId);
		const d = object(draft);
		if (typeof d.enabled !== 'boolean')
			throw new BotError('validation', 'enabled must be boolean');
		const condition = triggerCondition(d.condition, this.now());
		if (
			condition.kind !== 'event' &&
			previewSchedule(condition, this.now(), 1, this.timeZone).length === 0
		)
			throw new BotError('validation', 'schedule never matches');
		const previous = id ? this.store.trigger(botId, id) : undefined;
		const t: BotTrigger = {
			id: id ?? randomBytes(12).toString('hex'),
			botId,
			name: text(d.name, 256, 'trigger name'),
			enabled: d.enabled,
			prompt: text(d.prompt, 32 * 1024, 'prompt'),
			condition,
			evaluatedThrough: this.now(),
			missedCount: previous?.missedCount ?? 0,
			missedLatest: previous?.missedLatest ?? null,
		};
		this.store.putTrigger(t, expectedRevision);
		if (!t.enabled) this.cancelPending(botId, t.id);
		return t;
	}
	enable(
		botId: string,
		id: string,
		enabled: boolean,
		expectedRevision?: number,
	): void {
		const t = this.store.trigger(botId, triggerId(id));
		if (typeof enabled !== 'boolean')
			throw new BotError('validation', 'enabled must be boolean');
		const condition =
			t.condition.kind === 'every' && enabled
				? { ...t.condition, anchor: this.now() }
				: t.condition;
		if (
			enabled &&
			condition.kind !== 'event' &&
			previewSchedule(condition, this.now(), 1, this.timeZone).length === 0
		)
			throw new BotError('validation', 'schedule never matches');
		this.store.putTrigger(
			{ ...t, enabled, condition, evaluatedThrough: this.now() },
			expectedRevision,
		);
		if (!enabled) this.cancelPending(botId, id);
	}
	remove(botId: string, id: string, expectedRevision?: number): void {
		this.store.removeTrigger(botId, triggerId(id), expectedRevision);
		this.cancelPending(botId, id);
	}
	private cancelPending(botId: string, id: string): void {
		const token = this.pending.get(id);
		if (token) token.cancelled = true;
		this.service.queue.disableTrigger(botId, id);
	}
	removeBot(botId: string): void {
		for (const t of this.store.triggers(botId)) this.remove(botId, t.id);
	}
	dismissMissed(botId: string, id: string): void {
		const t = this.store.trigger(botId, triggerId(id));
		this.store.putTrigger({ ...t, missedCount: 0, missedLatest: null });
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
		if (
			through < from ||
			through - from > 366 * 24 * 60 * 60_000 ||
			!Number.isSafeInteger(limit) ||
			limit < 1 ||
			limit > 1000
		)
			throw new BotError('validation', 'invalid upcoming range or limit');
		if (after !== undefined) {
			const cursor = object(after);
			triggerTime(cursor.at);
			triggerId(cursor.triggerId);
		}
		const entries = this.store
			.triggers(botId)
			.flatMap((t) => {
				if (!t.enabled || t.condition.kind === 'event') return [];
				const start = Math.max(
					from,
					this.now() + 1,
					t.evaluatedThrough + 1,
					after?.at ?? 0,
				);
				return previewSchedule(
					t.condition,
					Math.max(
						0,
						start - (after?.at === start && t.id <= after.triggerId ? 0 : 1),
					),
					limit + 1,
					this.timeZone,
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
		const firings = entries.slice(0, limit);
		const last = firings.at(-1);
		return {
			firings,
			next:
				entries.length > limit && last
					? { at: last.at, triggerId: last.triggerId }
					: null,
		};
	}
	async runNow(botId: string, id: string): Promise<BotTriggerFiring> {
		return this.fire(
			this.store.trigger(botId, triggerId(id)),
			this.now(),
			'run-now',
		);
	}
	private async fire(
		trigger: BotTrigger,
		at: number,
		origin: 'trigger' | 'run-now',
		event?: TriggerEvent,
	): Promise<BotTriggerFiring> {
		const firing: BotTriggerFiring = {
			id: randomBytes(12).toString('hex'),
			botId: trigger.botId,
			triggerId: trigger.id,
			triggerName: trigger.name,
			firedAt: at,
			origin,
			sessionId: null,
			outcome: 'pending',
			reason: null,
		};
		const finish = (patch: Partial<BotTriggerFiring>) => {
			Object.assign(firing, patch);
			if (this.find(trigger.id)) this.store.putFiring(firing);
			return structuredClone(firing);
		};
		if (this.pending.has(trigger.id))
			return finish({ outcome: 'skipped', reason: 'bot busy' });
		const token = { cancelled: this.stopped };
		this.pending.set(trigger.id, token);
		finish({});
		try {
			const result = await this.service.send(
				trigger.botId,
				trigger.prompt + (event ? eventBlock(event, at, trigger) : ''),
				undefined,
				{
					kind: origin,
					triggerId: trigger.id,
					triggerName: trigger.name,
					fireTime: at,
				},
				() => !token.cancelled,
			);
			finish({ sessionId: result.sessionId });
			this.syncFirings(trigger.botId);
			return (
				this.firings(trigger.botId).find((f) => f.id === firing.id) ?? firing
			);
		} catch (error) {
			return finish({
				outcome: token.cancelled
					? 'skipped'
					: error instanceof BotError && error.code === 'resource'
						? 'skipped'
						: 'failed',
				reason: token.cancelled
					? 'cancelled'
					: error instanceof BotError && error.code === 'resource'
						? 'bot busy'
						: error instanceof BotError &&
								error.message === 'bot restart reconciliation is not complete'
							? 'container engine unavailable'
							: error instanceof BotError &&
									error.code === 'unavailable' &&
									this.store.get(trigger.botId).signIn.kind === 'none'
								? error.message
								: 'agent not ready',
			});
		} finally {
			this.pending.delete(trigger.id);
		}
	}
	private syncing = false;
	private syncFirings(botId?: string): void {
		if (this.syncing) return;
		this.syncing = true;
		try {
			for (const bot of this.store
				.list()
				.filter((b) => botId === undefined || b.id === botId)) {
				const records = new Map(
					this.service.sessions.list(bot.id).map((s) => [s.id, s]),
				);
				for (const f of this.store.firings(bot.id)) {
					if (!f.sessionId || !['pending', 'running'].includes(f.outcome))
						continue;
					const s = records.get(f.sessionId);
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
