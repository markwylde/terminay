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

export const MIN_INTERVAL_MS = 60 * 1000;
export const MAX_PROMPT_BYTES = 32 * 1024;
export const MAX_TRIGGERS = 50;
export const UPCOMING_DAYS = 7;

export type TriggerKind =
	| 'cron'
	| 'every'
	| 'once'
	| 'event'
	| 'command'
	| 'http'
	| 'sse'
	| 'files';

export const TRIGGER_KIND_LABELS: Readonly<Record<TriggerKind, string>> = {
	cron: 'Schedule',
	every: 'Interval',
	once: 'Once',
	event: 'Unsupported project event',
	command: 'Command result',
	http: 'HTTP response',
	sse: 'SSE event',
	files: 'File or folder changes',
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
			return 'Unsupported project event; choose a source';
		case 'command':
			return `${describeInterval(condition.intervalMs)} · ${condition.command}`;
		case 'http':
			return `${describeInterval(condition.intervalMs)} · ${condition.url}`;
		case 'sse':
			return `Events from ${condition.url}`;
		case 'files':
			return `Changes in ${condition.path}`;
	}
}

export type TriggerForm = Readonly<{
	name: string;
	recovery: import('@terminay/protocol').BotRecoveryPolicy;
	command: string;
	cwd: string;
	url: string;
	headers: string;
	storedHeaders: Readonly<Record<string, string>>;
	select: string;
	eventName: string;
	path: string;
	recursive: boolean;
	include: string;
	exclude: string;
	debounce: string;
	timeout: string;
	match: import('@terminay/protocol').BotSourceMatch['kind'];
	matchText: string;
	exitCode: string;
	items: string;
	identity: string;
	initial: 'process' | 'baseline';
	repeat: boolean;
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
		recovery: 'skip',
		command: '',
		cwd: '/home/bot',
		url: '',
		headers: '{}',
		storedHeaders: {},
		select: '',
		eventName: '',
		path: '/home/bot',
		recursive: true,
		include: '',
		exclude: '',
		debounce: '5000',
		timeout: '30000',
		match: 'changed',
		matchText: '',
		exitCode: '0',
		items: '',
		identity: '/id',
		initial: 'process',
		repeat: false,
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
		recovery: trigger.recovery ?? 'skip',
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
		case 'files':
			return {
				...shared,
				path: condition.path,
				recursive: condition.recursive !== false,
				include: condition.include ?? '',
				exclude: condition.exclude ?? '',
				debounce: String(condition.debounceMs ?? 5000),
			};
		case 'sse':
			return {
				...shared,
				url: condition.url,
				eventName: condition.eventName ?? '',
				headers: JSON.stringify(
					Object.fromEntries(
						Object.keys(condition.headers ?? {}).map((k) => [k, '••••']),
					),
					null,
					2,
				),
				storedHeaders: condition.headers ?? {},
			};
		case 'command':
		case 'http': {
			const match = condition.match ?? { kind: 'changed' };
			return {
				...shared,
				every: String(condition.intervalMs / 60000),
				everyUnit: 'minutes',
				timeout: String(condition.timeoutMs ?? 30000),
				match: match.kind,
				matchText: 'text' in match ? match.text : '',
				exitCode: 'code' in match ? String(match.code) : '0',
				items: 'items' in match ? match.items : '',
				identity: 'identity' in match ? match.identity : '/id',
				initial:
					match.kind === 'items' ? (match.initial ?? 'process') : 'process',
				repeat: 'repeat' in match && match.repeat === true,
				...(condition.kind === 'command'
					? { command: condition.command, cwd: condition.cwd ?? '/home/bot' }
					: {
							url: condition.url,
							select: condition.select ?? '',
							headers: JSON.stringify(
								Object.fromEntries(
									Object.keys(condition.headers ?? {}).map((k) => [k, '••••']),
								),
								null,
								2,
							),
							storedHeaders: condition.headers ?? {},
						}),
			};
		}
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
					problem: 'An interval must be at least 1 minute.',
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
			return { ok: false, problem: 'Choose a container source.' };
		case 'files':
			return {
				ok: true,
				condition: {
					kind: 'files',
					path: form.path,
					recursive: form.recursive,
					include: form.include,
					exclude: form.exclude,
					debounceMs: Number(form.debounce),
				},
			};
		case 'command':
		case 'http':
		case 'sse': {
			try {
				const headers: unknown = JSON.parse(form.headers);
				if (
					!headers ||
					typeof headers !== 'object' ||
					Array.isArray(headers) ||
					Object.values(headers).some((v) => typeof v !== 'string')
				)
					throw new Error('Headers must be a JSON object of strings.');
				const resolved = Object.fromEntries(
					Object.entries(headers).map(([k, v]) => [
						k,
						v === '••••' ? (form.storedHeaders[k] ?? '') : v,
					]),
				) as Record<string, string>;
				if (form.kind === 'sse')
					return {
						ok: true,
						condition: {
							kind: 'sse',
							url: form.url,
							headers: resolved,
							eventName: form.eventName,
						},
					};
				const intervalMs =
					Number(form.every) * (form.everyUnit === 'hours' ? 3600000 : 60000);
				if (!Number.isSafeInteger(intervalMs) || intervalMs < MIN_INTERVAL_MS)
					throw new Error('An interval must be at least 1 minute.');
				const match: import('@terminay/protocol').BotSourceMatch =
					form.match === 'items'
						? {
								kind: 'items',
								items: form.items,
								identity: form.identity,
								initial: form.initial,
							}
						: form.match === 'contains' || form.match === 'regex'
							? { kind: form.match, text: form.matchText, repeat: form.repeat }
							: form.match === 'exit'
								? {
										kind: 'exit',
										code: Number(form.exitCode),
										repeat: form.repeat,
									}
								: { kind: 'changed' };
				return {
					ok: true,
					condition:
						form.kind === 'command'
							? {
									kind: 'command',
									command: form.command,
									cwd: form.cwd,
									intervalMs,
									timeoutMs: Number(form.timeout),
									match,
								}
							: {
									kind: 'http',
									url: form.url,
									headers: resolved,
									select: form.select,
									intervalMs,
									timeoutMs: Number(form.timeout),
									match,
								},
				};
			} catch (error) {
				return {
					ok: false,
					problem: error instanceof Error ? error.message : 'Invalid source',
				};
			}
		}
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
			recovery: form.recovery,
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

/** One upcoming entry per trigger: its next firing, and whether it fires again
 * within the fetched window. In time order. */
export function distinctUpcoming(
	upcoming: readonly BotUpcomingFiring[],
): readonly Readonly<BotUpcomingFiring & { repeats: boolean }>[] {
	const byTrigger = new Map<string, BotUpcomingFiring & { repeats: boolean }>();
	for (const firing of upcoming) {
		const seen = byTrigger.get(firing.triggerId);
		if (seen === undefined)
			byTrigger.set(firing.triggerId, { ...firing, repeats: false });
		else
			byTrigger.set(firing.triggerId, {
				...(firing.at < seen.at ? firing : seen),
				repeats: true,
			});
	}
	return [...byTrigger.values()].sort((a, b) => a.at - b.at);
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

export type SourceGroup = 'Files' | 'Network' | 'Commands' | 'Time';
export const SOURCE_GROUPS: Readonly<
	Record<SourceGroup, readonly TriggerKind[]>
> = {
	Files: ['files'],
	Network: ['sse', 'http'],
	Commands: ['command'],
	Time: ['cron', 'every', 'once'],
};
export function sourceGroup(kind: TriggerKind): SourceGroup {
	return kind === 'files'
		? 'Files'
		: kind === 'sse' || kind === 'http'
			? 'Network'
			: kind === 'command'
				? 'Commands'
				: 'Time';
}
