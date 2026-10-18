import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createManualServerClock,
	embeddedManualServerClock,
} from '../electron/testServerClock.ts';

/**
 * The E2E-only held clock is inert in production, and while it is held no
 * period ends except by the test advancing it.
 */

test('the held clock applies only alongside the E2E marker', () => {
	assert.notEqual(
		embeddedManualServerClock({
			TERMINAY_TEST: '1',
			TERMINAY_TEST_SERVER_CLOCK: 'manual',
		}),
		undefined,
	);
	assert.equal(
		embeddedManualServerClock({ TERMINAY_TEST_SERVER_CLOCK: 'manual' }),
		undefined,
		'a production process ignores the variable',
	);
	assert.equal(
		embeddedManualServerClock({
			TERMINAY_TEST: '1',
			TERMINAY_TEST_SERVER_CLOCK: 'yes',
		}),
		undefined,
		'only the exact value counts',
	);
	assert.equal(embeddedManualServerClock({ TERMINAY_TEST: '1' }), undefined);
});

test('time stands still until advanced, and timers run in order at their own time', () => {
	const clock = createManualServerClock(1_000);
	const ran = [];
	clock.setTimeout(() => ran.push(['b', clock.now()]), 200);
	clock.setTimeout(() => {
		ran.push(['a', clock.now()]);
		// Armed while advancing, and due inside the same advance.
		clock.setTimeout(() => ran.push(['c', clock.now()]), 150);
	}, 100);
	const cancelled = clock.setTimeout(() => ran.push(['x', clock.now()]), 50);
	clock.clearTimeout(cancelled);
	clock.setTimeout(() => ran.push(['same-1', clock.now()]), 400);
	clock.setTimeout(() => ran.push(['same-2', clock.now()]), 400);

	assert.equal(clock.now(), 1_000);
	clock.advance(399);
	assert.deepEqual(ran, [
		['a', 1_100],
		['b', 1_200],
		['c', 1_250],
	]);
	assert.equal(clock.now(), 1_399);

	clock.advance(1);
	assert.deepEqual(ran.slice(3), [
		['same-1', 1_400],
		['same-2', 1_400],
	]);
	assert.throws(() => clock.advance(-1), RangeError);
});
