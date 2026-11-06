import assert from 'node:assert/strict';
import test from 'node:test';
import {
	describeCondition,
	distinctUpcoming,
	emptyTriggerForm,
	formFromTrigger,
	formToDraft,
	groupByDay,
	lastFirings,
	nextFirings,
} from './triggersModel.ts';

const NOW = new Date(2026, 10, 2, 8, 0).getTime();

test('a weekday cron is described in plain words', () => {
	const text = describeCondition({ kind: 'cron', cron: '0 9 * * 1-5' });
	assert.match(text, /weekday/i);
	assert.match(text, /9/);
});

test('intervals read in hours when whole, else minutes', () => {
	assert.equal(
		describeCondition({ kind: 'every', intervalMs: 6 * 3_600_000 }),
		'Every 6 hours',
	);
	assert.equal(
		describeCondition({ kind: 'every', intervalMs: 90 * 60_000 }),
		'Every 90 minutes',
	);
	assert.equal(
		describeCondition({ kind: 'event', event: 'agent.needsInput' }),
		'Unsupported project event; choose a source',
	);
});

test('an interval under 1 minute is refused, naming the minimum', () => {
	const form = {
		...emptyTriggerForm(NOW),
		name: 'Poll',
		prompt: 'Check',
		kind: 'every' as const,
		every: '0.5',
		everyUnit: 'minutes' as const,
	};
	const result = formToDraft(form);
	assert.equal(result.ok, false);
	assert.match(result.ok ? '' : result.problem, /1 minute/);
	assert.equal(formToDraft({ ...form, every: '5' }).ok, true);
});

test('an empty prompt is refused, naming the prompt', () => {
	const result = formToDraft({ ...emptyTriggerForm(NOW), name: 'x' });
	assert.equal(result.ok, false);
	assert.match(result.ok ? '' : result.problem, /prompt/i);
});

test('a trigger round-trips through the form', () => {
	const trigger = {
		id: 't1',
		botId: 'b',
		name: 'Nightly',
		enabled: false,
		prompt: 'Summarise failures',
		condition: { kind: 'every' as const, intervalMs: 3 * 3_600_000, anchor: 0 },
		evaluatedThrough: 0,
		missedCount: 0,
		missedLatest: null,
	};
	const result = formToDraft(formFromTrigger(trigger, NOW));
	assert.deepEqual(result, {
		ok: true,
		draft: {
			name: 'Nightly',
			enabled: false,
			prompt: 'Summarise failures',
			recovery: 'skip',
			condition: { kind: 'every', intervalMs: 3 * 3_600_000 },
		},
	});
});

test('upcoming firings interleave in time order, grouped by day', () => {
	const hour = 3_600_000;
	const upcoming = [
		{ triggerId: 'daily', triggerName: 'Daily', at: NOW + 25 * hour },
		{ triggerId: 'hourly', triggerName: 'Hourly', at: NOW + hour },
		{ triggerId: 'hourly', triggerName: 'Hourly', at: NOW + 2 * hour },
		{ triggerId: 'daily', triggerName: 'Daily', at: NOW + 3 * hour },
	];
	const groups = groupByDay(upcoming);
	assert.equal(groups.length, 2);
	assert.deepEqual(
		groups[0]?.firings.map((f) => f.at),
		[NOW + hour, NOW + 2 * hour, NOW + 3 * hour],
	);
	assert.equal(nextFirings(upcoming).get('daily'), NOW + 3 * hour);
});

test('the last firing per trigger is the newest', () => {
	const base = {
		botId: 'b',
		triggerName: 'T',
		origin: 'trigger' as const,
		sessionId: null,
		reason: null,
	};
	const latest = lastFirings([
		{ ...base, id: '1', triggerId: 'a', firedAt: 1, outcome: 'completed' },
		{ ...base, id: '2', triggerId: 'a', firedAt: 5, outcome: 'failed' },
		{ ...base, id: '3', triggerId: 'b', firedAt: 3, outcome: 'skipped' },
	]);
	assert.equal(latest.get('a')?.outcome, 'failed');
	assert.equal(latest.get('b')?.outcome, 'skipped');
});

test('upcoming shows each trigger once at its next firing, marking repeats', () => {
	const minute = (n: number) => NOW + n * 60_000;
	const list = distinctUpcoming([
		{ triggerId: 'pr', triggerName: 'Greet PRs', at: minute(2) },
		{ triggerId: 'pr', triggerName: 'Greet PRs', at: minute(1) },
		{ triggerId: 'daily', triggerName: 'Daily digest', at: minute(90) },
		{ triggerId: 'pr', triggerName: 'Greet PRs', at: minute(3) },
	]);
	assert.deepEqual(
		list.map((f) => [f.triggerId, f.at, f.repeats]),
		[
			['pr', minute(1), true],
			['daily', minute(90), false],
		],
	);
});
