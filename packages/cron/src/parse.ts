export type CronFieldName =
	| 'minute'
	| 'hour'
	| 'dayOfMonth'
	| 'month'
	| 'dayOfWeek';

/** The words used for each field in error messages and descriptions. */
export const CRON_FIELD_LABELS: Readonly<Record<CronFieldName, string>> = {
	minute: 'minute',
	hour: 'hour',
	dayOfMonth: 'day-of-month',
	month: 'month',
	dayOfWeek: 'day-of-week',
};

const FIELD_ORDER: readonly CronFieldName[] = [
	'minute',
	'hour',
	'dayOfMonth',
	'month',
	'dayOfWeek',
];

interface FieldSpec {
	readonly min: number;
	readonly max: number;
	readonly names?: readonly string[];
	readonly namesOffset?: number;
}

const MONTH_NAMES = [
	'JAN',
	'FEB',
	'MAR',
	'APR',
	'MAY',
	'JUN',
	'JUL',
	'AUG',
	'SEP',
	'OCT',
	'NOV',
	'DEC',
];
const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const FIELD_SPECS: Readonly<Record<CronFieldName, FieldSpec>> = {
	minute: { min: 0, max: 59 },
	hour: { min: 0, max: 23 },
	dayOfMonth: { min: 1, max: 31 },
	month: { min: 1, max: 12, names: MONTH_NAMES, namesOffset: 1 },
	// 7 is accepted as a second spelling of Sunday and folded to 0.
	dayOfWeek: { min: 0, max: 7, names: DAY_NAMES, namesOffset: 0 },
};

/** Longest month length, allowing for leap years. Index 0 is January. */
const MAX_DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * One comma-separated item of a field: `*`, `N`, `A-B`, each with an
 * optional `/step`. `star` is true for the `*` forms.
 */
export interface CronFieldItem {
	readonly star: boolean;
	readonly start: number;
	readonly end: number;
	readonly step: number;
}

export interface CronField {
	readonly name: CronFieldName;
	readonly source: string;
	readonly items: readonly CronFieldItem[];
	/** Sorted, de-duplicated matching values. Day-of-week uses 0-6, Sunday 0. */
	readonly values: readonly number[];
	/** True when the field starts with `*` (vixie semantics for day matching). */
	readonly star: boolean;
	/** True when the field matches every value in its range. */
	readonly all: boolean;
}

export interface CronSchedule {
	/** The expression, normalised to single spaces. */
	readonly expression: string;
	readonly minute: CronField;
	readonly hour: CronField;
	readonly dayOfMonth: CronField;
	readonly month: CronField;
	readonly dayOfWeek: CronField;
}

export class CronParseError extends Error {
	/** The field at fault, or null when the expression's shape is wrong. */
	readonly field: CronFieldName | null;

	constructor(message: string, field: CronFieldName | null) {
		super(message);
		this.name = 'CronParseError';
		this.field = field;
	}
}

function fieldError(
	field: CronFieldName,
	source: string,
	reason: string,
): CronParseError {
	return new CronParseError(
		`Invalid ${CRON_FIELD_LABELS[field]} field "${source}": ${reason}`,
		field,
	);
}

function parseValue(
	field: CronFieldName,
	source: string,
	token: string,
): number {
	const spec = FIELD_SPECS[field];
	let value: number;
	if (/^\d+$/.test(token)) {
		value = Number(token);
	} else if (spec.names && /^[a-z]{3}$/i.test(token)) {
		const index = spec.names.indexOf(token.toUpperCase());
		if (index < 0) {
			throw fieldError(field, source, `"${token}" is not a recognised name`);
		}
		value = index + (spec.namesOffset ?? 0);
	} else {
		throw fieldError(field, source, `"${token}" is not a number`);
	}
	if (value < spec.min || value > spec.max) {
		throw fieldError(
			field,
			source,
			`${value} is out of range ${spec.min}-${spec.max}`,
		);
	}
	return value;
}

function parseItem(
	field: CronFieldName,
	source: string,
	text: string,
): CronFieldItem {
	const spec = FIELD_SPECS[field];
	if (text === '') throw fieldError(field, source, 'empty list item');
	const parts = text.split('/');
	if (parts.length > 2) {
		throw fieldError(field, source, `"${text}" has more than one step`);
	}
	const [rangeText, stepText] = parts as [string, string | undefined];
	let step = 1;
	if (stepText !== undefined) {
		if (!/^\d+$/.test(stepText) || Number(stepText) < 1) {
			throw fieldError(
				field,
				source,
				`step "${stepText}" must be a positive whole number`,
			);
		}
		step = Number(stepText);
		if (step > spec.max - spec.min + 1) {
			throw fieldError(
				field,
				source,
				`step ${step} is larger than the field's range`,
			);
		}
	}
	if (rangeText === '*') {
		return { star: true, start: spec.min, end: spec.max, step };
	}
	const bounds = rangeText.split('-');
	if (bounds.length > 2 || bounds.some((bound) => bound === '')) {
		throw fieldError(field, source, `"${rangeText}" is not a valid range`);
	}
	const start = parseValue(field, source, bounds[0] as string);
	if (bounds.length === 2) {
		const end = parseValue(field, source, bounds[1] as string);
		if (end < start) {
			throw fieldError(
				field,
				source,
				`range ${bounds[0]}-${bounds[1]} runs backwards`,
			);
		}
		return { star: false, start, end, step };
	}
	// `N/step` means from N to the end of the field, as in vixie and cronie.
	return {
		star: false,
		start,
		end: stepText === undefined ? start : spec.max,
		step,
	};
}

function parseField(name: CronFieldName, source: string): CronField {
	const spec = FIELD_SPECS[name];
	const items = source.split(',').map((item) => parseItem(name, source, item));
	const set = new Set<number>();
	for (const item of items) {
		for (let value = item.start; value <= item.end; value += item.step) {
			set.add(name === 'dayOfWeek' && value === 7 ? 0 : value);
		}
	}
	const values = [...set].sort((a, b) => a - b);
	const span = name === 'dayOfWeek' ? 7 : spec.max - spec.min + 1;
	return {
		name,
		source,
		items,
		values,
		star: source.startsWith('*'),
		all: values.length === span,
	};
}

/**
 * Parse a standard five-field cron expression:
 * minute, hour, day of month, month, day of week.
 *
 * Throws {@link CronParseError} naming the invalid field, or when the
 * expression can never match (for example `0 0 31 2 *`).
 */
export function parseCron(expression: string): CronSchedule {
	if (typeof expression !== 'string') {
		throw new CronParseError('A cron expression must be text', null);
	}
	const trimmed = expression.trim();
	if (trimmed.startsWith('@')) {
		throw new CronParseError(
			`"${trimmed}" is not supported; use five fields: minute hour day-of-month month day-of-week`,
			null,
		);
	}
	const sources = trimmed === '' ? [] : trimmed.split(/\s+/);
	if (sources.length !== 5) {
		throw new CronParseError(
			`A cron expression needs five fields (minute hour day-of-month month day-of-week); got ${sources.length}`,
			null,
		);
	}
	const [minute, hour, dayOfMonth, month, dayOfWeek] = FIELD_ORDER.map(
		(name, index) => parseField(name, sources[index] as string),
	) as [CronField, CronField, CronField, CronField, CronField];

	// When day-of-week is `*`-based, day-of-month decides alone (vixie AND with
	// an unrestricted weekday), so it must exist in one of the months. In every
	// other combination some day always matches, so this is the only way a
	// well-formed expression can never run.
	if (dayOfWeek.star) {
		const possible = month.values.some((value) =>
			dayOfMonth.values.some(
				(day) => day <= (MAX_DAYS_IN_MONTH[value - 1] as number),
			),
		);
		if (!possible) {
			throw fieldError(
				'dayOfMonth',
				dayOfMonth.source,
				`never occurs in month field "${month.source}", so the schedule would never run`,
			);
		}
	}

	return {
		expression: sources.join(' '),
		minute,
		hour,
		dayOfMonth,
		month,
		dayOfWeek,
	};
}

export type CronValidation =
	| { readonly ok: true; readonly schedule: CronSchedule }
	| {
			readonly ok: false;
			readonly error: string;
			readonly field: CronFieldName | null;
	  };

/** Non-throwing form of {@link parseCron}. */
export function validateCron(expression: string): CronValidation {
	try {
		return { ok: true, schedule: parseCron(expression) };
	} catch (error) {
		if (error instanceof CronParseError) {
			return { ok: false, error: error.message, field: error.field };
		}
		throw error;
	}
}

/** Whether a calendar day matches, using vixie day-of-month/day-of-week rules. */
export function matchesDay(
	schedule: CronSchedule,
	dayOfMonth: number,
	month: number,
	dayOfWeek: number,
): boolean {
	if (!schedule.month.values.includes(month)) return false;
	const domMatch = schedule.dayOfMonth.values.includes(dayOfMonth);
	const dowMatch = schedule.dayOfWeek.values.includes(dayOfWeek);
	if (schedule.dayOfMonth.star || schedule.dayOfWeek.star) {
		return domMatch && dowMatch;
	}
	return domMatch || dowMatch;
}
