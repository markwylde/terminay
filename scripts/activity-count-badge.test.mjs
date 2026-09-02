import assert from 'node:assert/strict';
import test from 'node:test';
import {
	ACTIVITY_COUNT_BADGE_MAX,
	activityBadgeAriaLabel,
	activityBadgeStateForSource,
	activityCountDigits,
	formatActivityCount,
	summarizeActivityBadge,
} from '../src/workspace/activityCountBadge.ts';

test('formatActivityCount keeps small counts and caps above the maximum', () => {
	assert.equal(formatActivityCount(1), '1');
	assert.equal(formatActivityCount(12), '12');
	assert.equal(formatActivityCount(99), '99');
	assert.equal(formatActivityCount(100), '99+');
	assert.equal(formatActivityCount(1000), '99+');
	assert.equal(formatActivityCount(0), '0');
	assert.equal(ACTIVITY_COUNT_BADGE_MAX, 99);
});

test('activityCountDigits steps by label length so the circle never widens', () => {
	assert.equal(activityCountDigits('1'), 1);
	assert.equal(activityCountDigits('12'), 2);
	assert.equal(activityCountDigits('99'), 2);
	assert.equal(activityCountDigits('99+'), 3);
});

test('activityBadgeStateForSource maps terminal and agent states onto the badge palette', () => {
	assert.equal(activityBadgeStateForSource('attention'), 'attention');
	assert.equal(activityBadgeStateForSource('waiting'), 'attention');
	assert.equal(activityBadgeStateForSource('blocked'), 'attention');
	assert.equal(activityBadgeStateForSource('recent'), 'recent');
	assert.equal(activityBadgeStateForSource('working'), 'recent');
	assert.equal(activityBadgeStateForSource('unviewed'), 'unviewed');
	assert.equal(activityBadgeStateForSource('done'), 'unviewed');
});

test('summarizeActivityBadge counts every item and picks the highest priority state', () => {
	assert.equal(summarizeActivityBadge([]), null);
	assert.deepEqual(summarizeActivityBadge(['unviewed']), {
		count: 1,
		state: 'unviewed',
	});
	assert.deepEqual(summarizeActivityBadge(['unviewed', 'working']), {
		count: 2,
		state: 'recent',
	});
	assert.deepEqual(summarizeActivityBadge(['done', 'working', 'blocked']), {
		count: 3,
		state: 'attention',
	});
	assert.deepEqual(summarizeActivityBadge(['recent', 'attention', 'recent']), {
		count: 3,
		state: 'attention',
	});
});

test('activityBadgeAriaLabel describes count and state for assistive tech', () => {
	assert.equal(
		activityBadgeAriaLabel({ count: 1, state: 'unviewed' }),
		'1 terminal, finished',
	);
	assert.equal(
		activityBadgeAriaLabel({ count: 3, state: 'attention' }),
		'3 terminals, needs attention',
	);
	assert.equal(
		activityBadgeAriaLabel({ count: 2, state: 'recent' }),
		'2 terminals, working',
	);
});
