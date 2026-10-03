import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppBadgeTracker } from '../electron/appBadge.ts';

function tracker() {
	const calls = [];
	return { calls, badge: createAppBadgeTracker((count) => calls.push(count)) };
}

test('one window sets and clears the badge', () => {
	const { badge, calls } = tracker();
	badge.set(1, 3);
	badge.set(1, 2);
	badge.set(1, 0);
	assert.deepEqual(calls, [3, 2, 0]);
	assert.equal(badge.total(), 0);
});

test('windows sum, and a closed window takes its count with it', () => {
	const { badge, calls } = tracker();
	badge.set(1, 2);
	badge.set(2, 1);
	assert.equal(badge.total(), 3);
	badge.clear(1);
	assert.equal(badge.total(), 1);
	badge.clear(2);
	assert.deepEqual(calls, [2, 3, 1, 0]);
});

test('an unchanged total makes no native call', () => {
	const { badge, calls } = tracker();
	badge.set(1, 0);
	badge.clear(7);
	badge.reset();
	assert.deepEqual(calls, []);
	badge.set(1, 4);
	badge.set(1, 4);
	badge.set(2, 0);
	assert.deepEqual(calls, [4]);
});

test('reset leaves no badge behind', () => {
	const { badge, calls } = tracker();
	badge.set(1, 2);
	badge.set(2, 5);
	badge.reset();
	assert.deepEqual(calls, [2, 7, 0]);
	assert.equal(badge.total(), 0);
});

test('a failing native call does not reach the reporting window', () => {
	const badge = createAppBadgeTracker(() => {
		throw new Error('no launcher');
	});
	assert.doesNotThrow(() => badge.set(1, 1));
	assert.equal(badge.total(), 1);
});
