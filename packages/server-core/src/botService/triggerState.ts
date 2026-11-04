import type {
	BotTrigger,
	BotTriggerCondition,
	BotTriggerFiring,
} from '@terminay/protocol';
import { previewSchedule } from '../scheduleEngine/scheduler.js';
import { isObservation, observationSource, exact } from './sourceValidation.js';
import { TRIGGER_EVENT_KINDS } from '../scheduleEngine/types.js';
import { BotError, object, text } from './store.js';

export function triggerTime(value: unknown): number {
	if (
		!Number.isSafeInteger(value) ||
		(value as number) < 0 ||
		!Number.isFinite(new Date(value as number).getTime())
	)
		throw new BotError('validation', 'invalid trigger time');
	return value as number;
}
export function triggerId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-z0-9]{24}$/.test(value))
		throw new BotError('validation', 'invalid trigger id');
	return value;
}
export function triggerCondition(
	value: unknown,
	anchor: number,
): BotTriggerCondition {
	const d = object(value);
	if (['command', 'http', 'sse', 'files'].includes(String(d.kind)))
		return observationSource(d, anchor);
	if (
		d.kind === 'event' &&
		TRIGGER_EVENT_KINDS.some((kind) => kind === d.event)
	)
		return {
			kind: 'event',
			event: d.event as Extract<
				BotTriggerCondition,
				{ kind: 'event' }
			>['event'],
		};
	exact(
		d,
		d.kind === 'cron'
			? ['kind', 'cron']
			: d.kind === 'once'
				? ['kind', 'at']
				: ['kind', 'intervalMs', 'anchor'],
	);
	let schedule: import('@terminay/protocol').BotTriggerSchedule;
	if (d.kind === 'cron')
		schedule = { kind: 'cron', cron: text(d.cron, 256, 'cron') };
	else if (d.kind === 'once')
		schedule = { kind: 'once', at: triggerTime(d.at) };
	else if (d.kind === 'every')
		schedule = {
			kind: 'every',
			intervalMs: d.intervalMs as number,
			anchor: triggerTime(anchor),
		};
	else throw new BotError('validation', 'invalid trigger condition');
	try {
		previewSchedule(schedule, anchor, 1, undefined, 60000);
	} catch (error) {
		throw new BotError(
			'validation',
			error instanceof Error ? error.message : 'invalid schedule',
		);
	}
	return schedule;
}
export function storedTrigger(value: unknown): BotTrigger {
	const d = object(value);
	if (
		typeof d.enabled !== 'boolean' ||
		!Number.isSafeInteger(d.missedCount) ||
		(d.missedCount as number) < 0
	)
		throw new BotError('validation', 'invalid trigger');
	const raw = object(d.condition);
	const condition = triggerCondition(
		raw,
		typeof raw.anchor === 'number' ? triggerTime(raw.anchor) : 0,
	);
	const continuous = condition.kind === 'sse' || condition.kind === 'files';
	const recovery =
		d.recovery ??
		(isObservation(condition)
			? continuous
				? 'recover-available'
				: 'once'
			: 'skip');
	if (
		!(
			continuous
				? ['ignore-gap', 'recover-available']
				: ['skip', 'once', 'replay']
		).includes(String(recovery))
	)
		throw new BotError('validation', 'Invalid recovery policy');
	return {
		id: triggerId(d.id),
		botId: text(d.botId, 12, 'bot id'),
		name: text(d.name, 256, 'trigger name'),
		enabled: condition.kind === 'event' ? false : d.enabled,
		recovery: recovery as import('@terminay/protocol').BotRecoveryPolicy,
		generation:
			typeof d.generation === 'string'
				? triggerId(d.generation)
				: triggerId(d.id),
		...(condition.kind === 'event'
			? {
					unsupported:
						'Project events are unsupported. Choose a container source.',
				}
			: {}),
		prompt: text(d.prompt, 32 * 1024, 'prompt'),
		condition,
		evaluatedThrough: triggerTime(d.evaluatedThrough),
		missedCount: d.missedCount as number,
		missedLatest: d.missedLatest === null ? null : triggerTime(d.missedLatest),
	};
}
export function storedFiring(value: unknown): BotTriggerFiring {
	const d = object(value);
	if (
		!['pending', 'running', 'completed', 'failed', 'skipped'].includes(
			String(d.outcome),
		) ||
		!['trigger', 'run-now'].includes(String(d.origin))
	)
		throw new BotError('validation', 'invalid firing');
	return {
		id: triggerId(d.id),
		botId: text(d.botId, 12, 'bot id'),
		triggerId: triggerId(d.triggerId),
		triggerName: text(d.triggerName, 256, 'trigger name'),
		firedAt: triggerTime(d.firedAt),
		origin: d.origin as BotTriggerFiring['origin'],
		outcome: d.outcome as BotTriggerFiring['outcome'],
		sessionId: d.sessionId === null ? null : triggerId(d.sessionId),
		reason: d.reason === null ? null : text(d.reason, 1024, 'firing reason'),
	};
}
