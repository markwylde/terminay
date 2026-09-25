import {
	type CronField,
	type CronFieldItem,
	type CronSchedule,
	parseCron,
} from './parse.js';

const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];
const WEEKDAYS = [
	'Sunday',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
];
/** At most this many exact times are listed before falling back to fields. */
const MAX_LISTED_TIMES = 6;

function pad(value: number): string {
	return String(value).padStart(2, '0');
}

function clock(hour: number, minute: number): string {
	return `${pad(hour)}:${pad(minute)}`;
}

function joinWords(words: readonly string[]): string {
	if (words.length <= 1) return words[0] ?? '';
	return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

function isSingle(item: CronFieldItem): boolean {
	return !item.star && item.start === item.end;
}

function everyStep(field: CronField): number | null {
	if (field.items.length !== 1) return null;
	const [item] = field.items as [CronFieldItem];
	return item.star ? item.step : null;
}

function itemWords(
	item: CronFieldItem,
	name: (value: number) => string,
): string {
	if (isSingle(item)) return name(item.start);
	const range = `${name(item.start)} through ${name(item.end)}`;
	if (item.step === 1) return range;
	return `every ${item.step} from ${range}`;
}

function fieldWords(field: CronField, name: (value: number) => string): string {
	const stepped = field.items.some((item) => item.step > 1);
	if (stepped && field.values.length <= MAX_LISTED_TIMES) {
		return joinWords(field.values.map(name));
	}
	return joinWords(field.items.map((item) => itemWords(item, name)));
}

function ordinal(value: number): string {
	const tens = value % 100;
	if (tens >= 11 && tens <= 13) return `${value}th`;
	const suffix = ['th', 'st', 'nd', 'rd'][value % 10] ?? 'th';
	return `${value}${suffix}`;
}

function dayOfWeekName(value: number): string {
	return WEEKDAYS[value % 7] as string;
}

function sameValues(field: CronField, values: readonly number[]): boolean {
	return (
		field.values.length === values.length &&
		field.values.every((value, index) => value === values[index])
	);
}

function weekdayWords(field: CronField): string {
	if (sameValues(field, [1, 2, 3, 4, 5])) return 'weekdays';
	if (sameValues(field, [0, 6])) return 'weekends';
	return fieldWords(field, dayOfWeekName);
}

function timeWords(schedule: CronSchedule): {
	text: string;
	exact: boolean;
} {
	const { minute, hour } = schedule;
	if (
		minute.values.length === 1 &&
		!hour.star &&
		hour.values.length <= MAX_LISTED_TIMES
	) {
		const at = minute.values[0] as number;
		return {
			text: `at ${joinWords(hour.values.map((value) => clock(value, at)))}`,
			exact: true,
		};
	}
	const minuteStep = everyStep(minute);
	let minutes: string;
	if (minuteStep === 1) minutes = 'every minute';
	else if (minuteStep !== null) minutes = `every ${minuteStep} minutes`;
	else if (minute.values.length === 1 && hour.all) {
		const at = minute.values[0] as number;
		minutes =
			at === 0 ? 'every hour, on the hour' : `every hour at minute ${at}`;
		return { text: minutes, exact: false };
	} else {
		const label = minute.values.length === 1 ? 'minute' : 'minutes';
		minutes = `at ${label} ${fieldWords(minute, String)}`;
		if (hour.all) minutes += ' past every hour';
	}
	if (hour.all) return { text: minutes, exact: false };
	const hourStep = everyStep(hour);
	if (hourStep !== null && minute.values.length === 1) {
		const at = minute.values[0] as number;
		return {
			text:
				at === 0
					? `every ${hourStep} hours, on the hour`
					: `every ${hourStep} hours at minute ${at}`,
			exact: false,
		};
	}
	const hours =
		hourStep !== null
			? `every ${hourStep} hours`
			: `${hour.values.length === 1 ? 'hour' : 'hours'} ${fieldWords(
					hour,
					(value) => clock(value, 0),
				)}`;
	return {
		text: `${minutes} ${hourStep !== null ? 'of' : 'during'} ${hours}`,
		exact: false,
	};
}

function dayWords(schedule: CronSchedule): string {
	const { dayOfMonth, dayOfWeek } = schedule;
	const domRestricted = !dayOfMonth.all;
	const dowRestricted = !dayOfWeek.all;
	const domStep = everyStep(dayOfMonth);
	const domText =
		domStep !== null
			? `on every ${ordinal(domStep)} day of the month`
			: `on ${
					dayOfMonth.values.length === 1 ? 'day' : 'days'
				} ${fieldWords(dayOfMonth, String)} of the month`;
	const dowText = `on ${weekdayWords(dayOfWeek)}`;
	if (domRestricted && dowRestricted) {
		if (dayOfMonth.star || dayOfWeek.star)
			return `${domText} when it falls ${dowText}`;
		return `${domText} or ${dowText}`;
	}
	if (domRestricted) return domText;
	if (dowRestricted) return dowText;
	return '';
}

function capitalise(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Describe a cron expression in plain words, for example
 * `0 * * * *` → "Every hour, on the hour" and
 * `30 9 * * 1-5` → "Every weekday at 09:30". Times are 24-hour wall-clock
 * times in whichever zone the schedule is evaluated in.
 *
 * Throws {@link CronParseError} for an invalid expression.
 */
export function describeCron(expression: string | CronSchedule): string {
	const schedule =
		typeof expression === 'string' ? parseCron(expression) : expression;
	const time = timeWords(schedule);
	const days = dayWords(schedule);
	const months = schedule.month.all
		? ''
		: `in ${fieldWords(schedule.month, (value) => MONTHS[value - 1] as string)}`;

	if (time.exact && months === '') {
		if (days === '') return `Every day ${time.text}`;
		const { dayOfMonth, dayOfWeek } = schedule;
		if (dayOfMonth.all) {
			if (sameValues(dayOfWeek, [1, 2, 3, 4, 5])) {
				return `Every weekday ${time.text}`;
			}
			if (dayOfWeek.values.length === 1) {
				return `Every ${dayOfWeekName(dayOfWeek.values[0] as number)} ${time.text}`;
			}
		}
	}
	return capitalise([time.text, days, months].filter(Boolean).join(' '));
}
