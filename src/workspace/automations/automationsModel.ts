/**
 * The Automations section's model.
 *
 * Pure functions over what a server says about its automations: which
 * connection the section shows, how a trigger reads in plain words, when a
 * schedule next fires, how a run's outcome reads, how the editor's form turns
 * into a draft the server validates, and how the automation space's terminals
 * group by the run that opened them. Kept apart from React so each rule can be
 * tested on its own.
 */

import type {
	AutomationAction,
	AutomationDefinition,
	AutomationDraft,
	AutomationEventKind,
	AutomationRunEntry,
	AutomationSkipReason,
	AutomationTrigger,
	MacroFieldValue,
} from '@terminay/client-core';
import {
	type CronPreset,
	type CronWeekday,
	cronToPreset,
	describeCron,
	nextOccurrences,
	presetToCron,
	validateCron,
} from '@terminay/cron';

export const AUTOMATIONS_FEATURE = 'automations.v1';

// --- Server selection -------------------------------------------------------

/** One attached connection, as the section sees it. */
export type AutomationServerCandidate = Readonly<{
	serverId?: string;
	label: string;
	/** False while the connection cannot answer (offline, incompatible). */
	usable: boolean;
	capabilities?: readonly string[];
}>;

export type AutomationServerChoice = Readonly<{
	serverId: string;
	label: string;
}>;

export type AutomationServerSelection = Readonly<{
	/** Servers that serve automations; the selector offers these. */
	choices: readonly AutomationServerChoice[];
	selected?: AutomationServerChoice;
	/** A selector is offered only when there is a choice to make. */
	showsSelector: boolean;
	/** Usable servers that do not serve automations, for a short explanation. */
	unsupported: readonly AutomationServerChoice[];
}>;

export function supportsAutomations(
	capabilities: readonly string[] | undefined,
): boolean {
	return capabilities?.includes(AUTOMATIONS_FEATURE) === true;
}

/**
 * Which server the section shows: the one a person chose, else the one the
 * window is working in, else the first that serves automations. Automations
 * are per server and never merged, so exactly one is shown.
 */
export function selectAutomationServer(
	candidates: readonly AutomationServerCandidate[],
	requested: string | undefined,
	fallback: string | undefined,
): AutomationServerSelection {
	const choices: AutomationServerChoice[] = [];
	const unsupported: AutomationServerChoice[] = [];
	for (const candidate of candidates) {
		if (!candidate.usable || candidate.serverId === undefined) continue;
		const choice = Object.freeze({
			serverId: candidate.serverId,
			label: candidate.label,
		});
		if (supportsAutomations(candidate.capabilities)) choices.push(choice);
		else unsupported.push(choice);
	}
	const selected =
		choices.find((choice) => choice.serverId === requested) ??
		choices.find((choice) => choice.serverId === fallback) ??
		choices[0];
	return Object.freeze({
		choices: Object.freeze(choices),
		...(selected === undefined ? {} : { selected }),
		showsSelector: choices.length > 1,
		unsupported: Object.freeze(unsupported),
	});
}

// --- Triggers ---------------------------------------------------------------

export const AUTOMATION_EVENT_LABELS: Readonly<
	Record<AutomationEventKind, string>
> = Object.freeze({
	'agent.finished': 'Agent finished',
	'agent.needsInput': 'Agent needs input',
	'agent.blocked': 'Agent blocked',
	'terminal.needsAttention': 'Terminal needs attention',
	'terminal.commandFinished': 'Command finished',
	'terminal.idle': 'Terminal idle',
	'project.opened': 'Project opened',
	'project.closed': 'Project closed',
	'device.connected': 'Remote device connected',
});

const EVENT_PHRASES: Readonly<Record<AutomationEventKind, string>> =
	Object.freeze({
		'agent.finished': 'When an agent finishes',
		'agent.needsInput': 'When an agent needs input',
		'agent.blocked': 'When an agent is blocked',
		'terminal.needsAttention': 'When a terminal needs attention',
		'terminal.commandFinished': 'When a command finishes',
		'terminal.idle': 'When a terminal goes idle',
		'project.opened': 'When a project opens',
		'project.closed': 'When a project closes',
		'device.connected': 'When a remote device connects',
	});

/** Events whose subject is a terminal: the only ones a subject action serves. */
const TERMINAL_SUBJECT_EVENTS: ReadonlySet<AutomationEventKind> = new Set([
	'agent.finished',
	'agent.needsInput',
	'agent.blocked',
	'terminal.needsAttention',
	'terminal.commandFinished',
	'terminal.idle',
]);

export function hasTerminalSubject(trigger: AutomationTrigger): boolean {
	return trigger.kind === 'event' && TERMINAL_SUBJECT_EVENTS.has(trigger.event);
}

/** The trigger in plain words. Never throws: a bad expression reads as itself. */
export function describeTrigger(trigger: AutomationTrigger): string {
	if (trigger.kind === 'event') return EVENT_PHRASES[trigger.event];
	try {
		return describeCron(trigger.cron);
	} catch {
		return `On schedule ${trigger.cron}`;
	}
}

/** Epoch ms of the next scheduled run, or undefined when there is none. */
export function nextRunAt(
	automation: Pick<AutomationDefinition, 'enabled' | 'trigger'>,
	now: number,
	timeZone?: string,
): number | undefined {
	if (!automation.enabled || automation.trigger.kind !== 'schedule')
		return undefined;
	try {
		return nextOccurrences(automation.trigger.cron, new Date(now), 1, timeZone)[0]?.getTime();
	} catch {
		return undefined;
	}
}

export type SchedulePreview =
	| Readonly<{ ok: true; description: string; next: readonly number[] }>
	| Readonly<{ ok: false; error: string }>;

/** What the editor shows under a schedule: plain words and the next five runs. */
export function previewSchedule(
	cron: string,
	now: number,
	timeZone?: string,
): SchedulePreview {
	const expression = cron.trim().replace(/\s+/gu, ' ');
	if (expression.length === 0)
		return Object.freeze({ ok: false, error: 'Enter a schedule.' });
	const validation = validateCron(expression);
	if (!validation.ok)
		return Object.freeze({ ok: false, error: sentence(validation.error) });
	return Object.freeze({
		ok: true,
		description: describeCron(validation.schedule),
		next: Object.freeze(
			nextOccurrences(validation.schedule, new Date(now), 5, timeZone).map(
				(date) => date.getTime(),
			),
		),
	});
}

// --- Schedule presets ---------------------------------------------------------

export type SchedulePresetKind = CronPreset['kind'] | 'custom';

export const SCHEDULE_PRESET_LABELS: Readonly<
	Record<SchedulePresetKind, string>
> = Object.freeze({
	everyMinute: 'Every minute',
	everyNMinutes: 'Every N minutes',
	hourly: 'Every hour',
	daily: 'Every day',
	weekdays: 'On weekdays',
	weekly: 'Every week',
	custom: 'Custom (cron)',
});

export const SCHEDULE_PRESET_KINDS: readonly SchedulePresetKind[] = [
	'everyMinute',
	'everyNMinutes',
	'hourly',
	'daily',
	'weekdays',
	'weekly',
	'custom',
];

/** The preset the editor shows for an expression; `custom` when none fits. */
export function presetForCron(cron: string): CronPreset | { kind: 'custom' } {
	try {
		return cronToPreset(cron) ?? { kind: 'custom' };
	} catch {
		return { kind: 'custom' };
	}
}

/**
 * The expression a preset kind produces, carrying over the time and minute
 * the current preset already had so switching kinds keeps what was chosen.
 */
export function cronForPresetKind(
	kind: CronPreset['kind'],
	current: CronPreset | { kind: 'custom' },
): string {
	const hour = 'hour' in current ? current.hour : 9;
	const minute = 'minute' in current ? current.minute : 0;
	const dayOfWeek: CronWeekday =
		'dayOfWeek' in current ? current.dayOfWeek : 1;
	switch (kind) {
		case 'everyMinute':
			return presetToCron({ kind });
		case 'everyNMinutes':
			return presetToCron({
				kind,
				minutes: 'minutes' in current ? current.minutes : 15,
			});
		case 'hourly':
			return presetToCron({ kind, minute });
		case 'daily':
		case 'weekdays':
			return presetToCron({ kind, hour, minute });
		case 'weekly':
			return presetToCron({ kind, dayOfWeek, hour, minute });
	}
}

// --- Runs -------------------------------------------------------------------

const SKIP_REASONS: Readonly<Record<AutomationSkipReason, string>> =
	Object.freeze({
		previousRunStillRunning: 'the previous run was still running',
		subjectGone: 'the subject terminal was gone',
		concurrencyLimit: 'too many runs were in progress',
		automationSpaceFull: 'the automation space was full',
		executorUnavailable: 'automations could not run on this server',
	});

export type RunTone = 'running' | 'success' | 'failure' | 'neutral';

/** A run's outcome in words, and the tone to show it in. */
export function describeRunOutcome(
	run: Pick<
		AutomationRunEntry,
		'status' | 'outcome' | 'exitCode' | 'skipReason' | 'reason'
	>,
): Readonly<{ label: string; tone: RunTone }> {
	if (run.status === 'running') return { label: 'Running', tone: 'running' };
	switch (run.outcome) {
		case 'succeeded':
			return { label: 'Succeeded', tone: 'success' };
		case 'failed':
			return {
				label:
					run.exitCode === undefined
						? 'Failed'
						: `Failed (exit ${run.exitCode})`,
				tone: 'failure',
			};
		case 'timedOut':
			return { label: 'Timed out', tone: 'failure' };
		case 'stopped':
			return { label: 'Stopped', tone: 'neutral' };
		case 'skipped': {
			const why =
				run.skipReason === undefined
					? run.reason
					: SKIP_REASONS[run.skipReason];
			return {
				label: why === undefined ? 'Skipped' : `Skipped: ${why}`,
				tone: 'neutral',
			};
		}
		default:
			return { label: 'Finished', tone: 'neutral' };
	}
}

/** The overview widget's outcome vocabulary. */
export function overviewOutcome(
	run: Pick<AutomationRunEntry, 'status' | 'outcome'>,
): 'running' | 'success' | 'failure' | 'timed-out' | 'skipped' | 'cancelled' {
	if (run.status === 'running') return 'running';
	switch (run.outcome) {
		case 'succeeded':
			return 'success';
		case 'failed':
			return 'failure';
		case 'timedOut':
			return 'timed-out';
		case 'skipped':
			return 'skipped';
		default:
			return 'cancelled';
	}
}

export function formatDuration(ms: number | undefined): string {
	if (ms === undefined) return '—';
	if (ms < 1000) return `${ms} ms`;
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds} s`;
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	if (minutes < 60) return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
	const hours = Math.floor(minutes / 60);
	return `${hours} h ${minutes % 60} min`;
}

/** The latest run of each automation, keyed by automation id. */
export function latestRuns(
	runs: readonly AutomationRunEntry[],
): ReadonlyMap<string, AutomationRunEntry> {
	const latest = new Map<string, AutomationRunEntry>();
	for (const run of runs) {
		const current = latest.get(run.automationId);
		if (current === undefined || run.startedAt > current.startedAt)
			latest.set(run.automationId, run);
	}
	return latest;
}

// --- Automation space terminals -----------------------------------------------

export type AutomationSpaceTerminal = Readonly<{
	panelId: string;
	sessionId: string;
	title: string;
	status: 'running' | 'exited' | 'interrupted';
}>;

export type AutomationTerminalGroup = Readonly<{
	/** The run whose terminal this is; absent for terminals no run names. */
	run?: AutomationRunEntry;
	terminals: readonly AutomationSpaceTerminal[];
}>;

/**
 * Group the automation space's terminals under the run that owns them. A run
 * names its own terminal and every terminal it opened through MCP (the server
 * records those, including terminals opened by terminals it opened). A
 * terminal no run names (one whose run has aged out of the log) is listed
 * together at the end rather than hidden.
 */
export function groupSpaceTerminals(
	terminals: readonly AutomationSpaceTerminal[],
	runs: readonly AutomationRunEntry[],
): readonly AutomationTerminalGroup[] {
	const runBySession = new Map<string, AutomationRunEntry>();
	for (const run of runs) {
		if (run.sessionId !== undefined) runBySession.set(run.sessionId, run);
		for (const sessionId of run.openedSessions ?? [])
			if (!runBySession.has(sessionId)) runBySession.set(sessionId, run);
	}
	const groups = new Map<string, AutomationSpaceTerminal[]>();
	const unowned: AutomationSpaceTerminal[] = [];
	for (const terminal of terminals) {
		const run = runBySession.get(terminal.sessionId);
		if (run === undefined) {
			unowned.push(terminal);
			continue;
		}
		const list = groups.get(run.runId) ?? [];
		list.push(terminal);
		groups.set(run.runId, list);
	}
	const owned = [...groups.entries()]
		.map(([runId, list]) => ({
			run: runs.find((run) => run.runId === runId) as AutomationRunEntry,
			terminals: Object.freeze(list),
		}))
		.sort((left, right) => right.run.startedAt - left.run.startedAt);
	return Object.freeze([
		...owned.map((group) => Object.freeze(group)),
		...(unowned.length === 0
			? []
			: [Object.freeze({ terminals: Object.freeze(unowned) })]),
	]);
}

// --- Editor form ----------------------------------------------------------------

export type AutomationActionKind = AutomationAction['kind'];

export const ACTION_LABELS: Readonly<Record<AutomationActionKind, string>> =
	Object.freeze({
		runCommand: 'Run a command',
		runMacro: 'Run a Macro on the terminal',
		writeText: 'Write text into the terminal',
	});

/** The actions a trigger can serve, in the order the picker lists them. */
export function actionKindsFor(
	trigger: AutomationTrigger,
): readonly AutomationActionKind[] {
	return hasTerminalSubject(trigger)
		? ['runCommand', 'runMacro', 'writeText']
		: ['runCommand'];
}

/** Why an action cannot serve a trigger, in the server's words, or undefined. */
export function combinationProblem(
	trigger: AutomationTrigger,
	action: AutomationActionKind,
): string | undefined {
	if (action === 'runCommand' || hasTerminalSubject(trigger)) return undefined;
	if (trigger.kind === 'schedule')
		return 'Scheduled triggers have no subject terminal.';
	return trigger.event === 'device.connected'
		? 'Device events have no subject terminal.'
		: 'Project events have no subject terminal.';
}

export type AutomationForm = Readonly<{
	id?: string;
	name: string;
	enabled: boolean;
	triggerKind: 'schedule' | 'event';
	cron: string;
	event: AutomationEventKind;
	actionKind: AutomationActionKind;
	command: string;
	shellProfileId: string;
	cwd: string;
	/** Text, so a half-typed number is not lost; whole minutes. */
	maxDurationMinutes: string;
	macroId: string;
	fieldValues: Readonly<Record<string, MacroFieldValue>>;
	text: string;
	submit: boolean;
	keepTerminalAfterRun: boolean;
	recordSession: boolean;
	cooldownSeconds: string;
}>;

export const DEFAULT_SCHEDULE = '0 9 * * *';

export function emptyAutomationForm(): AutomationForm {
	return Object.freeze({
		name: '',
		enabled: true,
		triggerKind: 'schedule',
		cron: DEFAULT_SCHEDULE,
		event: 'agent.finished',
		actionKind: 'runCommand',
		command: '',
		shellProfileId: '',
		cwd: '',
		maxDurationMinutes: '60',
		macroId: '',
		fieldValues: Object.freeze({}),
		text: '',
		submit: true,
		keepTerminalAfterRun: false,
		recordSession: false,
		cooldownSeconds: '60',
	});
}

/** The editor's form for a saved automation. `duplicate` drops the identity. */
export function formFromAutomation(
	automation: AutomationDefinition,
	duplicate = false,
): AutomationForm {
	const base = emptyAutomationForm();
	const { action, trigger, settings } = automation;
	return Object.freeze({
		...base,
		...(duplicate ? {} : { id: automation.id }),
		name: duplicate ? `${automation.name} copy` : automation.name,
		enabled: automation.enabled,
		triggerKind: trigger.kind,
		cron: trigger.kind === 'schedule' ? trigger.cron : base.cron,
		event: trigger.kind === 'event' ? trigger.event : base.event,
		actionKind: action.kind,
		...(action.kind === 'runCommand'
			? {
					command: action.command,
					shellProfileId: action.shellProfileId ?? '',
					cwd: action.cwd ?? '',
					maxDurationMinutes: String(
						Math.max(1, Math.round(action.maxDurationSeconds / 60)),
					),
				}
			: {}),
		...(action.kind === 'runMacro'
			? { macroId: action.macroId, fieldValues: action.fieldValues }
			: {}),
		...(action.kind === 'writeText'
			? { text: action.text, submit: action.submit }
			: {}),
		keepTerminalAfterRun: settings.keepTerminalAfterRun,
		recordSession: settings.recordSession,
		cooldownSeconds: String(settings.cooldownSeconds),
	});
}

export function formTrigger(form: AutomationForm): AutomationTrigger {
	return form.triggerKind === 'schedule'
		? { kind: 'schedule', cron: form.cron.trim().replace(/\s+/gu, ' ') }
		: { kind: 'event', event: form.event };
}

export type DraftResult =
	| Readonly<{ ok: true; draft: AutomationDraft }>
	| Readonly<{ ok: false; error: string }>;

/**
 * The draft the server validates. Only what the form cannot express at all
 * (a number that is not a number) is refused here; everything else — a bad
 * schedule, a trigger the action cannot serve, a missing Macro field — is the
 * server's to refuse, so its reason is the one the person reads.
 */
export function formToDraft(form: AutomationForm): DraftResult {
	const maxMinutes = wholeNumber(form.maxDurationMinutes);
	if (form.actionKind === 'runCommand' && maxMinutes === undefined)
		return fail('Maximum duration must be a whole number of minutes.');
	const cooldown = wholeNumber(form.cooldownSeconds);
	if (cooldown === undefined)
		return fail('Cooldown must be a whole number of seconds.');
	let action: AutomationDraft['action'];
	switch (form.actionKind) {
		case 'runCommand':
			action = {
				kind: 'runCommand',
				command: form.command,
				...(form.shellProfileId === ''
					? {}
					: { shellProfileId: form.shellProfileId }),
				...(form.cwd.trim() === '' ? {} : { cwd: form.cwd.trim() }),
				maxDurationSeconds: (maxMinutes as number) * 60,
			};
			break;
		case 'runMacro':
			if (form.macroId === '') return fail('Choose a Macro to run.');
			action = {
				kind: 'runMacro',
				macroId: form.macroId,
				fieldValues: form.fieldValues,
			};
			break;
		case 'writeText':
			action = { kind: 'writeText', text: form.text, submit: form.submit };
			break;
	}
	return Object.freeze({
		ok: true,
		draft: {
			...(form.id === undefined ? {} : { id: form.id }),
			name: form.name,
			enabled: form.enabled,
			trigger: formTrigger(form),
			action,
			settings: {
				keepTerminalAfterRun: form.keepTerminalAfterRun,
				recordSession: form.recordSession,
				cooldownSeconds: cooldown,
			},
		},
	});
}

/** A server refusal as a sentence a person reads. */
export function refusalMessage(error: unknown): string {
	const message =
		error instanceof Error
			? error.message
			: typeof error === 'string'
				? error
				: 'The server refused the request.';
	return sentence(message.replace(/^automation\s+/iu, ''));
}

function sentence(text: string): string {
	const trimmed = text.trim();
	if (trimmed.length === 0) return trimmed;
	const capitalised = trimmed[0]?.toUpperCase() + trimmed.slice(1);
	return /[.!?]$/u.test(capitalised) ? capitalised : `${capitalised}.`;
}

function wholeNumber(value: string): number | undefined {
	const trimmed = value.trim();
	if (!/^\d+$/u.test(trimmed)) return undefined;
	const parsed = Number(trimmed);
	return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function fail(error: string): DraftResult {
	return Object.freeze({ ok: false, error });
}
