import assert from 'node:assert/strict';
import test from 'node:test';
import {
	CronParseError,
	cronToPreset,
	dailyAt,
	describeCron,
	everyMinute,
	everyNMinutes,
	hourlyAt,
	localTimeZone,
	nextOccurrence,
	nextOccurrences,
	parseCron,
	presetToCron,
	validateCron,
	weekdaysAt,
	weeklyAt,
} from '../dist/index.js';

const iso = (dates) => dates.map((date) => date.toISOString());

test('parses lists, ranges, steps, and names into matching values', () => {
	const cases = [
		['* * * * *', 'minute', 60, [0, 1, 2]],
		['0,15,30,45 * * * *', 'minute', 4, [0, 15, 30, 45]],
		['10-12 * * * *', 'minute', 3, [10, 11, 12]],
		['*/20 * * * *', 'minute', 3, [0, 20, 40]],
		['5/20 * * * *', 'minute', 3, [5, 25, 45]],
		['0-30/10,59 * * * *', 'minute', 5, [0, 10, 20, 30, 59]],
		['0 */6 * * *', 'hour', 4, [0, 6, 12, 18]],
		['0 0 1,15 * *', 'dayOfMonth', 2, [1, 15]],
		['0 0 * jan-mar *', 'month', 3, [1, 2, 3]],
		['0 0 * */4 *', 'month', 3, [1, 5, 9]],
		['0 0 * * mon-fri', 'dayOfWeek', 5, [1, 2, 3, 4, 5]],
		['0 0 * * 7', 'dayOfWeek', 1, [0]],
		['0 0 * * 0,7', 'dayOfWeek', 1, [0]],
		['0 0 * * SAT,sun', 'dayOfWeek', 2, [0, 6]],
		['0 0 * * 5-7', 'dayOfWeek', 3, [0, 5, 6]],
	];
	for (const [expression, field, size, prefix] of cases) {
		const values = parseCron(expression)[field].values;
		assert.equal(values.length, size, expression);
		assert.deepEqual(values.slice(0, prefix.length), prefix, expression);
	}
});

test('normalises whitespace in the expression', () => {
	assert.equal(parseCron('  0   9 *\t* 1-5 ').expression, '0 9 * * 1-5');
});

test('refuses invalid expressions and names the invalid field', () => {
	const cases = [
		['61 * * * *', 'minute', /minute field "61".*out of range 0-59/],
		['* 24 * * *', 'hour', /hour field "24"/],
		['* * 0 * *', 'dayOfMonth', /day-of-month field "0"/],
		['* * 32 * *', 'dayOfMonth', /day-of-month/],
		['* * * 13 *', 'month', /month field "13"/],
		['* * * foo *', 'month', /"foo" is not a recognised name/],
		['* * * * 8', 'dayOfWeek', /day-of-week field "8"/],
		['* * * * funday', 'dayOfWeek', /day-of-week/],
		['5-1 * * * *', 'minute', /runs backwards/],
		['*/0 * * * *', 'minute', /positive whole number/],
		['*/61 * * * *', 'minute', /larger than the field's range/],
		['1,,2 * * * *', 'minute', /empty list item/],
		['1-2-3 * * * *', 'minute', /not a valid range/],
		['*/2/2 * * * *', 'minute', /more than one step/],
		['a * * * *', 'minute', /"a" is not a number/],
		['-1 * * * *', 'minute', /not a valid range/],
		['* * * * *', null, null],
	];
	for (const [expression, field, message] of cases) {
		const result = validateCron(expression);
		if (field === null) {
			assert.equal(result.ok, true, expression);
			continue;
		}
		assert.equal(result.ok, false, expression);
		assert.equal(result.field, field, expression);
		assert.match(result.error, message, expression);
		assert.throws(
			() => parseCron(expression),
			(error) => error instanceof CronParseError && error.field === field,
		);
	}
});

test('refuses expressions with the wrong shape', () => {
	for (const expression of [
		'',
		'* * * *',
		'* * * * * *',
		'@hourly',
		'0 0 * * * 2026',
	]) {
		const result = validateCron(expression);
		assert.equal(result.ok, false, expression);
		assert.equal(result.field, null, expression);
	}
});

test('refuses expressions that can never match', () => {
	const refused = [
		'0 0 31 2 *',
		'0 0 30 2 *',
		'0 0 31 4,6,9,11 *',
		'0 0 30,31 feb *',
		// A `*`-based weekday does not rescue it: vixie ANDs the two fields.
		'0 0 30 2 */2',
	];
	for (const expression of refused) {
		const result = validateCron(expression);
		assert.equal(result.ok, false, expression);
		assert.equal(result.field, 'dayOfMonth', expression);
		assert.match(result.error, /never/, expression);
	}
	// Possible somewhere, or rescued by the day-of-week OR rule.
	for (const expression of ['0 0 29 2 *', '0 0 31 2,3 *', '0 0 31 2 1']) {
		assert.equal(validateCron(expression).ok, true, expression);
	}
});

test('applies day-of-month / day-of-week OR semantics when both are restricted', () => {
	// 2026-02-01 is a Sunday.
	const from = new Date('2026-02-01T00:00:00Z');
	const cases = [
		// Both restricted: the 13th OR any Friday.
		[
			'0 0 13 * 5',
			[
				'2026-02-06T00:00:00.000Z',
				'2026-02-13T00:00:00.000Z',
				'2026-02-20T00:00:00.000Z',
				'2026-02-27T00:00:00.000Z',
				'2026-03-06T00:00:00.000Z',
				'2026-03-13T00:00:00.000Z',
			],
		],
		// Day-of-week only.
		[
			'0 0 * * 1',
			[
				'2026-02-02T00:00:00.000Z',
				'2026-02-09T00:00:00.000Z',
				'2026-02-16T00:00:00.000Z',
			],
		],
		// Day-of-month only.
		[
			'0 0 10,20 * *',
			[
				'2026-02-10T00:00:00.000Z',
				'2026-02-20T00:00:00.000Z',
				'2026-03-10T00:00:00.000Z',
			],
		],
		// A `*`-based day-of-month ANDs with the weekday, as in vixie cron:
		// odd days that are also Mondays.
		[
			'0 0 */2 * 1',
			[
				'2026-02-09T00:00:00.000Z',
				'2026-02-23T00:00:00.000Z',
				'2026-03-09T00:00:00.000Z',
			],
		],
	];
	for (const [expression, expected] of cases) {
		assert.deepEqual(
			iso(nextOccurrences(expression, from, expected.length, 'UTC')),
			expected,
			expression,
		);
	}
});

test('finds next occurrences strictly after the start at one-minute resolution', () => {
	const cases = [
		[
			'* * * * *',
			'2026-05-01T10:00:30Z',
			['2026-05-01T10:01:00.000Z', '2026-05-01T10:02:00.000Z'],
		],
		['* * * * *', '2026-05-01T10:00:00Z', ['2026-05-01T10:01:00.000Z']],
		[
			'*/15 * * * *',
			'2026-05-01T10:07:00Z',
			[
				'2026-05-01T10:15:00.000Z',
				'2026-05-01T10:30:00.000Z',
				'2026-05-01T10:45:00.000Z',
				'2026-05-01T11:00:00.000Z',
			],
		],
		[
			'0 * * * *',
			'2026-12-31T22:30:00Z',
			[
				'2026-12-31T23:00:00.000Z',
				'2027-01-01T00:00:00.000Z',
				'2027-01-01T01:00:00.000Z',
			],
		],
		[
			'30 9 * * 1-5',
			'2026-05-01T12:00:00Z',
			['2026-05-04T09:30:00.000Z', '2026-05-05T09:30:00.000Z'],
		],
		[
			'0 0 29 2 *',
			'2026-01-01T00:00:00Z',
			['2028-02-29T00:00:00.000Z', '2032-02-29T00:00:00.000Z'],
		],
	];
	for (const [expression, from, expected] of cases) {
		assert.deepEqual(
			iso(nextOccurrences(expression, new Date(from), expected.length, 'UTC')),
			expected,
			expression,
		);
	}
	assert.equal(
		nextOccurrence(
			'0 0 1 1 *',
			new Date('2026-06-01T00:00:00Z'),
			'UTC',
		)?.toISOString(),
		'2027-01-01T00:00:00.000Z',
	);
});

test('evaluates in the given zone', () => {
	const cases = [
		['America/New_York', '2026-07-01T12:00:00Z', '2026-07-01T13:00:00.000Z'],
		['Europe/London', '2026-07-01T12:00:00Z', '2026-07-02T08:00:00.000Z'],
		['Asia/Kolkata', '2026-07-01T12:00:00Z', '2026-07-02T03:30:00.000Z'],
		['UTC', '2026-07-01T12:00:00Z', '2026-07-02T09:00:00.000Z'],
	];
	for (const [zone, from, expected] of cases) {
		assert.equal(
			nextOccurrence('0 9 * * *', new Date(from), zone)?.toISOString(),
			expected,
			zone,
		);
	}
});

test('defaults to the host zone and rejects unknown zones and bad arguments', () => {
	const from = new Date('2026-07-01T12:00:00Z');
	assert.deepEqual(
		iso(nextOccurrences('17 3 * * *', from, 3)),
		iso(nextOccurrences('17 3 * * *', from, 3, localTimeZone())),
	);
	assert.throws(
		() => nextOccurrences('* * * * *', from, 1, 'Mars/Olympus_Mons'),
		RangeError,
	);
	assert.throws(
		() => nextOccurrences('* * * * *', new Date(Number.NaN), 1),
		TypeError,
	);
	assert.throws(() => nextOccurrences('* * * * *', from, -1), RangeError);
	assert.deepEqual(nextOccurrences('* * * * *', from, 0), []);
	assert.throws(() => nextOccurrences('61 * * * *', from, 1), CronParseError);
	assert.deepEqual(
		iso(nextOccurrences(parseCron('0 0 * * *'), from, 1, 'UTC')),
		['2026-07-02T00:00:00.000Z'],
	);
});

test('skips wall-clock times in a DST gap', () => {
	const cases = [
		// New York springs forward 2026-03-08 02:00 EST -> 03:00 EDT.
		[
			'America/New_York',
			'30 2 * * *',
			'2026-03-07T12:00:00Z',
			['2026-03-09T06:30:00.000Z', '2026-03-10T06:30:00.000Z'],
		],
		[
			'America/New_York',
			'*/30 * * * *',
			'2026-03-08T06:00:00Z',
			[
				'2026-03-08T06:30:00.000Z', // 01:30 EST
				'2026-03-08T07:00:00.000Z', // 03:00 EDT
				'2026-03-08T07:30:00.000Z', // 03:30 EDT
			],
		],
		[
			'America/New_York',
			'0 * * * *',
			'2026-03-08T06:30:00Z',
			['2026-03-08T07:00:00.000Z', '2026-03-08T08:00:00.000Z'],
		],
		// London springs forward 2026-03-29 01:00 GMT -> 02:00 BST.
		[
			'Europe/London',
			'30 1 * * *',
			'2026-03-28T12:00:00Z',
			['2026-03-30T00:30:00.000Z', '2026-03-31T00:30:00.000Z'],
		],
	];
	for (const [zone, expression, from, expected] of cases) {
		assert.deepEqual(
			iso(nextOccurrences(expression, new Date(from), expected.length, zone)),
			expected,
			`${zone} ${expression}`,
		);
	}
});

test('fires a wall-clock time repeated by a DST overlap once', () => {
	const cases = [
		// New York falls back 2026-11-01 02:00 EDT -> 01:00 EST.
		[
			'America/New_York',
			'30 1 * * *',
			'2026-10-31T12:00:00Z',
			['2026-11-01T05:30:00.000Z', '2026-11-02T06:30:00.000Z'],
		],
		[
			'America/New_York',
			'*/30 * * * *',
			'2026-11-01T04:00:00Z',
			[
				'2026-11-01T04:30:00.000Z', // 00:30 EDT
				'2026-11-01T05:00:00.000Z', // 01:00 EDT
				'2026-11-01T05:30:00.000Z', // 01:30 EDT
				'2026-11-01T07:00:00.000Z', // 02:00 EST; the repeated hour is not rerun
			],
		],
		// Starting inside the repeated hour does not fire its times again.
		[
			'America/New_York',
			'*/20 * * * *',
			'2026-11-01T06:10:00Z',
			['2026-11-01T07:00:00.000Z'],
		],
		// London falls back 2026-10-25 02:00 BST -> 01:00 GMT.
		[
			'Europe/London',
			'30 1 * * *',
			'2026-10-24T12:00:00Z',
			['2026-10-25T00:30:00.000Z', '2026-10-26T01:30:00.000Z'],
		],
	];
	for (const [zone, expression, from, expected] of cases) {
		assert.deepEqual(
			iso(nextOccurrences(expression, new Date(from), expected.length, zone)),
			expected,
			`${zone} ${expression}`,
		);
	}
});

test('describes schedules in plain words', () => {
	const cases = [
		['* * * * *', 'Every minute'],
		['*/15 * * * *', 'Every 15 minutes'],
		['0 * * * *', 'Every hour, on the hour'],
		['5 * * * *', 'Every hour at minute 5'],
		['0 */2 * * *', 'Every 2 hours, on the hour'],
		['30 9 * * *', 'Every day at 09:30'],
		['0 9,17 * * *', 'Every day at 09:00 and 17:00'],
		['30 9 * * 1-5', 'Every weekday at 09:30'],
		['0 9 * * 1', 'Every Monday at 09:00'],
		['0 9 * * sun', 'Every Sunday at 09:00'],
		['0 12 * * 0,6', 'At 12:00 on weekends'],
		['0 0 1 * *', 'At 00:00 on day 1 of the month'],
		['0 9 13 * 5', 'At 09:00 on day 13 of the month or on Friday'],
		[
			'0 0 1 jan-mar *',
			'At 00:00 on day 1 of the month in January through March',
		],
		[
			'*/5 9-17 * * 1-5',
			'Every 5 minutes during hours 09:00 through 17:00 on weekdays',
		],
		['0-30/10 * * * *', 'At minutes 0, 10, 20 and 30 past every hour'],
	];
	for (const [expression, expected] of cases) {
		assert.equal(describeCron(expression), expected, expression);
	}
	assert.throws(() => describeCron('61 * * * *'), CronParseError);
});

test('preset builders produce expressions that round-trip', () => {
	const cases = [
		[everyMinute(), '* * * * *', { kind: 'everyMinute' }],
		[everyNMinutes(1), '* * * * *', { kind: 'everyMinute' }],
		[everyNMinutes(10), '*/10 * * * *', { kind: 'everyNMinutes', minutes: 10 }],
		[hourlyAt(0), '0 * * * *', { kind: 'hourly', minute: 0 }],
		[hourlyAt(45), '45 * * * *', { kind: 'hourly', minute: 45 }],
		[dailyAt(7, 5), '5 7 * * *', { kind: 'daily', hour: 7, minute: 5 }],
		[
			weekdaysAt(9, 30),
			'30 9 * * 1-5',
			{ kind: 'weekdays', hour: 9, minute: 30 },
		],
		[
			weeklyAt(0, 23, 59),
			'59 23 * * 0',
			{ kind: 'weekly', dayOfWeek: 0, hour: 23, minute: 59 },
		],
	];
	for (const [expression, expected, preset] of cases) {
		assert.equal(expression, expected);
		assert.equal(validateCron(expression).ok, true, expression);
		assert.deepEqual(cronToPreset(expression), preset, expression);
		assert.equal(
			presetToCron(preset),
			preset.kind === 'everyMinute' ? '* * * * *' : expected,
		);
	}
	assert.equal(cronToPreset('0 0 1 * *'), null);
	assert.equal(cronToPreset('0 9,17 * * *'), null);
	assert.equal(cronToPreset('0 9 * * 1,3'), null);
	for (const build of [
		() => everyNMinutes(0),
		() => everyNMinutes(60),
		() => hourlyAt(60),
		() => dailyAt(24, 0),
		() => weekdaysAt(9, 1.5),
		() => weeklyAt(7, 0, 0),
	]) {
		assert.throws(build, RangeError);
	}
});

test('the hourly preset matches the spec scenario', () => {
	const expression = hourlyAt(0);
	assert.equal(expression, '0 * * * *');
	assert.equal(describeCron(expression), 'Every hour, on the hour');
	assert.deepEqual(
		iso(
			nextOccurrences(expression, new Date('2026-05-01T10:20:00Z'), 5, 'UTC'),
		),
		[
			'2026-05-01T11:00:00.000Z',
			'2026-05-01T12:00:00.000Z',
			'2026-05-01T13:00:00.000Z',
			'2026-05-01T14:00:00.000Z',
			'2026-05-01T15:00:00.000Z',
		],
	);
});
