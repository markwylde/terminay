import { validateCron as validateCronExpression } from '@terminay/cron';
import type { MacroFieldValue } from '../macroService/types.js';
import { AutomationServiceError } from './errors.js';
import {
	AUTOMATION_EVENT_KINDS,
	AUTOMATION_TERMINAL_SUBJECT_EVENTS,
	type AutomationAction,
	type AutomationCronValidator,
	type AutomationDefinition,
	type AutomationEventKind,
	type AutomationSettings,
	type AutomationTrigger,
	DEFAULT_AUTOMATION_COOLDOWN_SECONDS,
	DEFAULT_AUTOMATION_MAX_DURATION_SECONDS,
	MIN_SUBJECT_ACTION_COOLDOWN_SECONDS,
} from './types.js';

export const AUTOMATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_NAME_LENGTH = 200;
const MAX_COMMAND_BYTES = 16_384;
const MAX_TEXT_BYTES = 16_384;
const MAX_CWD_LENGTH = 4096;
const MAX_CRON_LENGTH = 256;
const MAX_FIELD_VALUES = 128;
const MAX_DURATION_SECONDS = 7 * 24 * 60 * 60;
const MAX_COOLDOWN_SECONDS = 24 * 60 * 60;
// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

export interface NormalizeAutomationContext {
	/** The existing definition with the same id, if any. */
	readonly existing?: AutomationDefinition;
	readonly now: number;
	readonly generateId: () => string;
	readonly validateCron: AutomationCronValidator;
}

/** Validate and normalise a client-supplied definition. The server-maintained
 * `evaluatedThrough` is never taken from the input. */
export function normalizeAutomation(
	input: unknown,
	context: NormalizeAutomationContext,
): AutomationDefinition {
	const record = asRecord(input);
	if (record === undefined) throw invalid('automation', 'must be an object');
	const id =
		record.id === undefined || record.id === ''
			? context.generateId()
			: boundedId(record.id, 'id');
	const name = normalizeName(record.name);
	const enabled = optionalBoolean(record.enabled, 'enabled', true);
	const trigger = normalizeTrigger(record.trigger, context.validateCron);
	const action = normalizeAction(record.action);
	assertCombination(trigger, action);
	const settings = normalizeSettings(record.settings, action);
	const evaluatedThrough =
		context.existing?.enabled &&
		enabled &&
		sameSchedule(context.existing.trigger, trigger)
			? context.existing.evaluatedThrough
			: context.now;
	return { id, name, enabled, trigger, action, settings, evaluatedThrough };
}

/** Structural normalisation of a persisted definition. Throws when the stored
 * value cannot be served; the caller drops it and keeps a backup. */
export function normalizePersistedAutomation(
	input: unknown,
	validateCron: AutomationCronValidator,
	now: number,
): AutomationDefinition {
	const record = asRecord(input);
	if (record === undefined) throw invalid('automation', 'must be an object');
	const definition = normalizeAutomation(input, {
		now,
		generateId: () => {
			throw invalid('id', 'is required');
		},
		validateCron,
	});
	const evaluatedThrough =
		typeof record.evaluatedThrough === 'number' &&
		Number.isSafeInteger(record.evaluatedThrough) &&
		record.evaluatedThrough >= 0
			? record.evaluatedThrough
			: now;
	return { ...definition, evaluatedThrough };
}

export function normalizeTrigger(
	value: unknown,
	validateCron: AutomationCronValidator,
): AutomationTrigger {
	const record = asRecord(value);
	if (record === undefined) throw invalid('trigger', 'must be an object');
	if (record.kind === 'schedule') {
		if (typeof record.cron !== 'string')
			throw invalid('trigger.cron', 'must be a cron expression');
		const cron = record.cron.trim().replace(/\s+/gu, ' ');
		if (cron.length === 0 || cron.length > MAX_CRON_LENGTH)
			throw invalid('trigger.cron', 'must be a cron expression');
		const refusal = validateCron(cron);
		if (refusal !== undefined)
			throw new AutomationServiceError(
				'invalid_automation',
				`schedule is invalid: ${refusal.reason}`,
				{
					field: 'trigger.cron',
					reason: refusal.reason,
					...(refusal.field === undefined
						? {}
						: { cronField: refusal.field }),
				},
			);
		return { kind: 'schedule', cron };
	}
	if (record.kind === 'event') {
		if (!isEventKind(record.event))
			throw invalid('trigger.event', 'is not a Terminay event');
		return { kind: 'event', event: record.event };
	}
	throw invalid('trigger.kind', 'must be schedule or event');
}

export function normalizeAction(value: unknown): AutomationAction {
	const record = asRecord(value);
	if (record === undefined) throw invalid('action', 'must be an object');
	switch (record.kind) {
		case 'runCommand': {
			const command = boundedText(
				record.command,
				'action.command',
				MAX_COMMAND_BYTES,
			);
			if (command.trim().length === 0 || command.includes('\0'))
				throw invalid('action.command', 'must be a command line');
			const shellProfileId =
				record.shellProfileId === undefined || record.shellProfileId === ''
					? undefined
					: boundedId(record.shellProfileId, 'action.shellProfileId');
			let cwd: string | undefined;
			if (record.cwd !== undefined && record.cwd !== '') {
				if (
					typeof record.cwd !== 'string' ||
					record.cwd.length > MAX_CWD_LENGTH ||
					CONTROL_CHARACTERS.test(record.cwd)
				)
					throw invalid('action.cwd', 'must be a directory path');
				cwd = record.cwd;
			}
			const maxDurationSeconds = boundedInteger(
				record.maxDurationSeconds,
				'action.maxDurationSeconds',
				DEFAULT_AUTOMATION_MAX_DURATION_SECONDS,
				1,
				MAX_DURATION_SECONDS,
			);
			return {
				kind: 'runCommand',
				command,
				...(shellProfileId === undefined ? {} : { shellProfileId }),
				...(cwd === undefined ? {} : { cwd }),
				maxDurationSeconds,
			};
		}
		case 'runMacro':
			return {
				kind: 'runMacro',
				macroId: boundedId(record.macroId, 'action.macroId'),
				fieldValues: normalizeFieldValues(record.fieldValues),
			};
		case 'writeText': {
			const text =
				record.text === undefined
					? ''
					: boundedText(record.text, 'action.text', MAX_TEXT_BYTES);
			if (text.includes('\0'))
				throw invalid('action.text', 'must not contain NUL');
			const submit = optionalBoolean(record.submit, 'action.submit', false);
			if (text.length === 0 && !submit)
				throw invalid('action.text', 'must not be empty');
			return { kind: 'writeText', text, submit };
		}
		default:
			throw invalid(
				'action.kind',
				'must be runCommand, runMacro, or writeText',
			);
	}
}

/** Refuse an action the trigger cannot serve, naming the reason. */
export function assertCombination(
	trigger: AutomationTrigger,
	action: AutomationAction,
): void {
	if (action.kind === 'runCommand') return;
	const reason = subjectActionRefusal(trigger);
	if (reason !== undefined)
		throw new AutomationServiceError('invalid_combination', reason, {
			reason,
			trigger: trigger.kind === 'schedule' ? 'schedule' : trigger.event,
			action: action.kind,
		});
}

/** Why a subject-terminal action cannot serve this trigger, or undefined. */
export function subjectActionRefusal(
	trigger: AutomationTrigger,
): string | undefined {
	if (trigger.kind === 'schedule')
		return 'scheduled triggers have no subject terminal';
	if (AUTOMATION_TERMINAL_SUBJECT_EVENTS.has(trigger.event)) return undefined;
	if (trigger.event === 'device.connected')
		return 'device events have no subject terminal';
	return 'project events have no subject terminal';
}

export function normalizeSettings(
	value: unknown,
	action: AutomationAction,
): AutomationSettings {
	const record = asRecord(value ?? {});
	if (record === undefined) throw invalid('settings', 'must be an object');
	const subjectAction = action.kind !== 'runCommand';
	const cooldownSeconds = boundedInteger(
		record.cooldownSeconds,
		'settings.cooldownSeconds',
		DEFAULT_AUTOMATION_COOLDOWN_SECONDS,
		subjectAction ? MIN_SUBJECT_ACTION_COOLDOWN_SECONDS : 0,
		MAX_COOLDOWN_SECONDS,
	);
	return {
		keepTerminalAfterRun: optionalBoolean(
			record.keepTerminalAfterRun,
			'settings.keepTerminalAfterRun',
			false,
		),
		recordSession: optionalBoolean(
			record.recordSession,
			'settings.recordSession',
			false,
		),
		cooldownSeconds,
	};
}

/** The shared five-field parser: refuses unparseable expressions and ones
 * that never match, naming the field at fault. */
export const cronValidator: AutomationCronValidator = (expression) => {
	const result = validateCronExpression(expression);
	if (result.ok) return undefined;
	return result.field === null || result.field === undefined
		? { reason: result.error }
		: { reason: result.error, field: result.field };
};

export function isEventKind(value: unknown): value is AutomationEventKind {
	return (
		typeof value === 'string' &&
		(AUTOMATION_EVENT_KINDS as readonly string[]).includes(value)
	);
}

function normalizeFieldValues(
	value: unknown,
): Readonly<Record<string, MacroFieldValue>> {
	if (value === undefined) return {};
	const record = asRecord(value);
	if (record === undefined)
		throw invalid('action.fieldValues', 'must be an object');
	const entries = Object.entries(record);
	if (entries.length > MAX_FIELD_VALUES)
		throw invalid('action.fieldValues', 'has too many values');
	const result: Record<string, MacroFieldValue> = {};
	for (const [name, candidate] of entries) {
		if (name.length === 0 || name.length > 256 || name.includes('\0'))
			throw invalid('action.fieldValues', 'has an invalid field name');
		if (typeof candidate === 'string') {
			if (new TextEncoder().encode(candidate).byteLength > MAX_TEXT_BYTES)
				throw invalid('action.fieldValues', 'has a value that is too long');
			result[name] = candidate;
		} else if (
			typeof candidate === 'boolean' ||
			(typeof candidate === 'number' && Number.isFinite(candidate))
		)
			result[name] = candidate;
		else throw invalid('action.fieldValues', 'has an invalid value');
	}
	return result;
}

function normalizeName(value: unknown): string {
	if (typeof value !== 'string') throw invalid('name', 'is required');
	const name = value.trim();
	if (
		name.length === 0 ||
		name.length > MAX_NAME_LENGTH ||
		CONTROL_CHARACTERS.test(name)
	)
		throw invalid('name', `must be 1-${MAX_NAME_LENGTH} printable characters`);
	return name;
}

function sameSchedule(left: AutomationTrigger, right: AutomationTrigger) {
	return (
		left.kind === 'schedule' &&
		right.kind === 'schedule' &&
		left.cron === right.cron
	);
}

function boundedId(value: unknown, field: string): string {
	if (typeof value !== 'string' || !AUTOMATION_ID_PATTERN.test(value))
		throw invalid(field, 'is invalid');
	return value;
}

function boundedText(value: unknown, field: string, maxBytes: number): string {
	if (typeof value !== 'string') throw invalid(field, 'must be text');
	if (new TextEncoder().encode(value).byteLength > maxBytes)
		throw invalid(field, `must be at most ${maxBytes} bytes`);
	return value;
}

function boundedInteger(
	value: unknown,
	field: string,
	fallback: number,
	minimum: number,
	maximum: number,
): number {
	if (value === undefined) return Math.max(fallback, minimum);
	if (
		typeof value !== 'number' ||
		!Number.isSafeInteger(value) ||
		value < minimum ||
		value > maximum
	)
		throw invalid(field, `must be a whole number from ${minimum} to ${maximum}`);
	return value;
}

function optionalBoolean(
	value: unknown,
	field: string,
	fallback: boolean,
): boolean {
	if (value === undefined) return fallback;
	if (typeof value !== 'boolean') throw invalid(field, 'must be true or false');
	return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function invalid(field: string, problem: string): AutomationServiceError {
	return new AutomationServiceError(
		'invalid_automation',
		`automation ${field} ${problem}`,
		{ field },
	);
}
