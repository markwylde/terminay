import { type CronSchedule, parseCron } from './parse.js';

/** Day of week, Sunday 0 through Saturday 6. */
export type CronWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type CronPreset =
	| { readonly kind: 'everyMinute' }
	| { readonly kind: 'everyNMinutes'; readonly minutes: number }
	| { readonly kind: 'hourly'; readonly minute: number }
	| { readonly kind: 'daily'; readonly hour: number; readonly minute: number }
	| {
			readonly kind: 'weekdays';
			readonly hour: number;
			readonly minute: number;
	  }
	| {
			readonly kind: 'weekly';
			readonly dayOfWeek: CronWeekday;
			readonly hour: number;
			readonly minute: number;
	  };

function whole(name: string, value: number, min: number, max: number): number {
	if (!Number.isInteger(value) || value < min || value > max) {
		throw new RangeError(
			`${name} must be a whole number from ${min} to ${max}`,
		);
	}
	return value;
}

/** `* * * * *` */
export function everyMinute(): string {
	return '* * * * *';
}

/** `*\/N * * * *` for N from 1 to 59; steps restart at the top of each hour. */
export function everyNMinutes(minutes: number): string {
	whole('minutes', minutes, 1, 59);
	return minutes === 1 ? everyMinute() : `*/${minutes} * * * *`;
}

/** `M * * * *` */
export function hourlyAt(minute: number): string {
	return `${whole('minute', minute, 0, 59)} * * * *`;
}

/** `M H * * *` */
export function dailyAt(hour: number, minute: number): string {
	return `${whole('minute', minute, 0, 59)} ${whole('hour', hour, 0, 23)} * * *`;
}

/** `M H * * 1-5` */
export function weekdaysAt(hour: number, minute: number): string {
	return `${whole('minute', minute, 0, 59)} ${whole('hour', hour, 0, 23)} * * 1-5`;
}

/** `M H * * D`, with D from 0 (Sunday) to 6 (Saturday). */
export function weeklyAt(
	dayOfWeek: CronWeekday,
	hour: number,
	minute: number,
): string {
	return `${whole('minute', minute, 0, 59)} ${whole('hour', hour, 0, 23)} * * ${whole('dayOfWeek', dayOfWeek, 0, 6)}`;
}

/** The cron expression a preset produces. */
export function presetToCron(preset: CronPreset): string {
	switch (preset.kind) {
		case 'everyMinute':
			return everyMinute();
		case 'everyNMinutes':
			return everyNMinutes(preset.minutes);
		case 'hourly':
			return hourlyAt(preset.minute);
		case 'daily':
			return dailyAt(preset.hour, preset.minute);
		case 'weekdays':
			return weekdaysAt(preset.hour, preset.minute);
		case 'weekly':
			return weeklyAt(preset.dayOfWeek, preset.hour, preset.minute);
	}
}

/**
 * The preset an expression is equivalent to, or null when it needs the raw
 * cron field. Lets an editor reopen a saved schedule on the matching preset.
 */
export function cronToPreset(
	expression: string | CronSchedule,
): CronPreset | null {
	const schedule =
		typeof expression === 'string' ? parseCron(expression) : expression;
	const { minute, hour, dayOfMonth, month, dayOfWeek } = schedule;
	if (!dayOfMonth.all || !month.all) return null;
	const singleMinute = minute.values.length === 1 ? minute.values[0] : null;
	const singleHour = hour.values.length === 1 ? hour.values[0] : null;
	if (dayOfWeek.all) {
		if (minute.all && hour.all) return { kind: 'everyMinute' };
		const [item] = minute.items;
		if (hour.all && minute.items.length === 1 && item?.star && item.step > 1) {
			return { kind: 'everyNMinutes', minutes: item.step };
		}
		if (hour.all && singleMinute !== null && singleMinute !== undefined) {
			return { kind: 'hourly', minute: singleMinute };
		}
	}
	if (
		singleMinute === null ||
		singleMinute === undefined ||
		singleHour === null ||
		singleHour === undefined
	) {
		return null;
	}
	if (dayOfWeek.all) {
		return { kind: 'daily', hour: singleHour, minute: singleMinute };
	}
	const days = dayOfWeek.values;
	if (days.length === 5 && days.every((day, index) => day === index + 1)) {
		return { kind: 'weekdays', hour: singleHour, minute: singleMinute };
	}
	if (days.length === 1) {
		return {
			kind: 'weekly',
			dayOfWeek: days[0] as CronWeekday,
			hour: singleHour,
			minute: singleMinute,
		};
	}
	return null;
}
