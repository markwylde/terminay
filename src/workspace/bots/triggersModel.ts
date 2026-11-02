/**
 * Bot triggers as the Triggers tab edits and describes them. Pure, so the
 * editor's rules are tested without rendering.
 */

import { describeCron } from '@terminay/cron';
import type {
	BotTrigger,
	BotTriggerCondition,
	BotTriggerDraft,
	BotTriggerEventKind,
	BotTriggerFiring,
	BotUpcomingFiring,
} from '@terminay/protocol';
import { AUTOMATION_EVENT_LABELS } from '../automations/automationsModel.ts';

export const MIN_INTERVAL_MS = 5 * 60 * 1000;
export const MAX_PROMPT_BYTES = 32 * 1024;
export const MAX_TRIGGERS = 50;
export const UPCOMING_DAYS = 7;

export type TriggerKind = 'cron' | 'every' | 'once' | 'event';

export const TRIGGER_KIND_LABELS: Readonly<Record<TriggerKind, string>> = {
	cron: 'Schedule',
	every: 'Interval',
	once: 'Once',
	event: 'Event',
};

export const BOT_EVENT_KINDS = Object.keys(
	AUTOMATION_EVENT_LABELS,
) as BotTriggerEventKind[];

export function eventLabel(event: BotTriggerEventKind): string {
	return AUTOMATION_EVENT_LABELS[event] ?? event;
}

function plural(n: number, unit: string): string {
	return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

export function describeInterval(intervalMs: number): string {
	const minutes = Math.round(intervalMs / 60_000);
	if (minutes % 60 === 0) return `Every ${plural(minutes / 60, 'hour')}`;
	return `Every ${plural(minutes, 'minute')}`;
}

/** A trigger's condition in plain words. */
export function describeCondition(
	condition: BotTriggerCondition | BotTriggerDraft['condition'],
	formatTime: (at: number) => string = (at) => new Date(at).toLocaleString(),
): string {
	switch (condition.kind) {
		case 'cron':
			try {
				return describeCron(condition.cron);
			} catch {
				return `Cron ${condition.cron}`;
			}
		case 'every':
			return describeInterval(condition.intervalMs);
		case 'once':
			return `Once, ${formatTime(condition.at)}`;
		case 'event':
			return `When: ${eventLabel(condition.event)}`;
	}
}

export type TriggerForm = Readonly<{
	name: string;
	enabled: boolean;
	prompt: string;
	kind: TriggerKind;
	cron: string;
	/** Interval amount and unit, as typed. */
	every: string;
	everyUnit: 'minutes' | 'hours';
	/** `YYYY-MM-DDTHH:mm`, in local time, as a datetime-local input holds. */
	at: string;
	event: BotTriggerEventKind;
}>;

function localInput(at: number): string {
	const d = new Date(at);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function emptyTriggerForm(now: number): TriggerForm {
	return {
		name: '',
		enabled: true,
		prompt: '',
		kind: 'cron',
		cron: '0 9 * * 1-5',
		every: '1',
		everyUnit: 'hours',
		at: localInput(now + 60 * 60 * 1000),
		event: 'agent.needsInput',
	};
}

export function formFromTrigger(trigger: BotTrigger, now: number): TriggerForm {
	const base = emptyTriggerForm(now);
	const { condition } = trigger;
	const shared = {
		...base,
		name: trigger.name,
		enabled: trigger.enabled,
		prompt: trigger.prompt,
		kind: condition.kind,
	};
	switch (condition.kind) {
		case 'cron':
			return { ...shared, cron: condition.cron };
		case 'every': {
			const minutes = Math.round(condition.intervalMs / 60_000);
			return minutes % 60 === 0
				? { ...shared, every: String(minutes / 60), everyUnit: 'hours' }
				: { ...shared, every: String(minutes), everyUnit: 'minutes' };
		}
		case 'once':
			return { ...shared, at: localInput(condition.at) };
		case 'event':
			return { ...shared, event: condition.event };
	}
}

export type FormCondition = BotTriggerDraft['condition'];

/** The condition a form describes, or why it cannot be saved. */
export function formCondition(
	form: TriggerForm,
): { ok: true; condition: FormCondition } | { ok: false; problem: string } {
	switch (form.kind) {
		case 'cron': {
			const cron = form.cron.trim().replace(/\s+/g, ' ');
			if (cron.split(' ').length !== 5)
				return {
					ok: false,
					problem: 'A schedule needs a five-field cron expression.',
				};
			return { ok: true, condition: { kind: 'cron', cron } };
		}
		case 'every': {
			const amount = Number(form.every);
			if (!Number.isFinite(amount) || amount <= 0)
				return { ok: false, problem: 'Enter how often the trigger repeats.' };
			const intervalMs = Math.round(
				amount * (form.everyUnit === 'hours' ? 3_600_000 : 60_000),
			);
			if (intervalMs < MIN_INTERVAL_MS)
				return {
					ok: false,
					problem: 'An interval must be at least 5 minutes.',
				};
			return { ok: true, condition: { kind: 'every', intervalMs } };
		}
		case 'once': {
			const at = new Date(form.at).getTime();
			if (!Number.isFinite(at))
				return { ok: false, problem: 'Choose a date and time.' };
			return { ok: true, condition: { kind: 'once', at } };
		}
		case 'event':
			return { ok: true, condition: { kind: 'event', event: form.event } };
	}
}

export function formToDraft(
	form: TriggerForm,
): { ok: true; draft: BotTriggerDraft } | { ok: false; problem: string } {
	if (form.name.trim().length === 0)
		return { ok: false, problem: 'Give the trigger a name.' };
	if (form.prompt.trim().length === 0)
		return { ok: false, problem: 'The prompt is empty.' };
	if (new TextEncoder().encode(form.prompt).length > MAX_PROMPT_BYTES)
		return { ok: false, problem: 'The prompt is longer than 32 KiB.' };
	const condition = formCondition(form);
	if (!condition.ok) return condition;
	return {
		ok: true,
		draft: {
			name: form.name.trim(),
			enabled: form.enabled,
			prompt: form.prompt,
			condition: condition.condition,
		},
	};
}

/** Each trigger's latest firing, newest first in the input. */
export function lastFirings(
	firings: readonly BotTriggerFiring[],
): ReadonlyMap<string, BotTriggerFiring> {
	const latest = new Map<string, BotTriggerFiring>();
	for (const firing of firings) {
		const seen = latest.get(firing.triggerId);
		if (seen === undefined || firing.firedAt > seen.firedAt)
			latest.set(firing.triggerId, firing);
	}
	return latest;
}

/** Each trigger's next firing from an upcoming list. */
export function nextFirings(
	upcoming: readonly BotUpcomingFiring[],
): ReadonlyMap<string, number> {
	const next = new Map<string, number>();
	for (const firing of upcoming) {
		const seen = next.get(firing.triggerId);
		if (seen === undefined || firing.at < seen)
			next.set(firing.triggerId, firing.at);
	}
	return next;
}

/** Upcoming firings grouped by local day, in time order. */
export function groupByDay(
	upcoming: readonly BotUpcomingFiring[],
): readonly Readonly<{ day: string; firings: readonly BotUpcomingFiring[] }>[] {
	const groups: { day: string; firings: BotUpcomingFiring[] }[] = [];
	for (const firing of [...upcoming].sort((a, b) => a.at - b.at)) {
		const d = new Date(firing.at);
		const day = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
		const last = groups.at(-1);
		if (last?.day === day) last.firings.push(firing);
		else groups.push({ day, firings: [firing] });
	}
	return groups;
}

export const FIRING_OUTCOME_LABELS: Readonly<
	Record<BotTriggerFiring['outcome'], string>
> = {
	pending: 'Queued',
	running: 'Running',
	completed: 'Completed',
	failed: 'Failed',
	skipped: 'Skipped',
};
