import { type CronSchedule, matchesDay, parseCron } from './parse.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Leap-day schedules restricted by weekday can take 28 years to recur. */
const SEARCH_DAYS = 366 * 30;
/** No zone is offset from UTC by more than this. */
const MAX_OFFSET = 15 * HOUR;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
	let formatter = formatters.get(timeZone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-US', {
			timeZone,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric',
		});
		formatters.set(timeZone, formatter);
	}
	return formatter;
}

/** The host's IANA time zone. */
export function localTimeZone(): string {
	return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
function offsetAt(timeZone: string, instant: number): number {
	const parts = formatterFor(timeZone).formatToParts(new Date(instant));
	const get = (type: string) =>
		Number(parts.find((part) => part.type === type)?.value);
	const wall = Date.UTC(
		get('year'),
		get('month') - 1,
		get('day'),
		get('hour'),
		get('minute'),
		get('second'),
	);
	const wholeSecond = instant - (((instant % 1000) + 1000) % 1000);
	return wall - wholeSecond;
}

/**
 * The earliest instant whose wall-clock time in `timeZone` equals `wall`
 * (wall-clock time expressed as UTC milliseconds), or null when that time
 * does not exist because of a DST gap.
 */
function earliestInstantForWall(timeZone: string, wall: number): number | null {
	const offsets = new Set([
		offsetAt(timeZone, wall - MAX_OFFSET - DAY),
		offsetAt(timeZone, wall),
		offsetAt(timeZone, wall + MAX_OFFSET + DAY),
	]);
	let earliest: number | null = null;
	for (const offset of offsets) {
		const instant = wall - offset;
		if (offsetAt(timeZone, instant) === offset) {
			if (earliest === null || instant < earliest) earliest = instant;
		}
	}
	return earliest;
}

function resolveTimeZone(timeZone: string | undefined): string {
	const zone = timeZone ?? localTimeZone();
	try {
		formatterFor(zone);
	} catch {
		throw new RangeError(`Unknown time zone: ${zone}`);
	}
	return zone;
}

/**
 * The next `count` times the schedule fires strictly after `from`, evaluated
 * at one-minute resolution in the IANA `timeZone` (the host's zone when
 * omitted).
 *
 * A wall-clock time skipped by a DST gap does not fire. A wall-clock time
 * repeated by a DST overlap fires once, at its first occurrence.
 */
export function nextOccurrences(
	expression: string | CronSchedule,
	from: Date,
	count: number,
	timeZone?: string,
): Date[] {
	const schedule =
		typeof expression === 'string' ? parseCron(expression) : expression;
	if (!(from instanceof Date) || Number.isNaN(from.getTime())) {
		throw new TypeError('from must be a valid Date');
	}
	if (!Number.isInteger(count) || count < 0) {
		throw new RangeError('count must be a non-negative whole number');
	}
	const zone = resolveTimeZone(timeZone);
	const results: Date[] = [];
	if (count === 0) return results;

	const after = from.getTime();
	// Any wall time that could map to an instant after `from` is later than
	// this, so iteration starts on its calendar day.
	const lowestWall = after - MAX_OFFSET;
	const startDay = Math.floor(lowestWall / DAY) * DAY;

	for (let dayIndex = 0; dayIndex < SEARCH_DAYS; dayIndex += 1) {
		const dayStart = startDay + dayIndex * DAY;
		const date = new Date(dayStart);
		if (
			!matchesDay(
				schedule,
				date.getUTCDate(),
				date.getUTCMonth() + 1,
				date.getUTCDay(),
			)
		) {
			continue;
		}
		for (const hour of schedule.hour.values) {
			const hourStart = dayStart + hour * HOUR;
			if (hourStart + HOUR <= lowestWall) continue;
			for (const minute of schedule.minute.values) {
				const wall = hourStart + minute * MINUTE;
				if (wall <= lowestWall) continue;
				const instant = earliestInstantForWall(zone, wall);
				if (instant === null || instant <= after) continue;
				results.push(new Date(instant));
				if (results.length === count) return results;
			}
		}
	}
	return results;
}

/** The first time the schedule fires strictly after `from`, or null. */
export function nextOccurrence(
	expression: string | CronSchedule,
	from: Date,
	timeZone?: string,
): Date | null {
	return nextOccurrences(expression, from, 1, timeZone)[0] ?? null;
}
