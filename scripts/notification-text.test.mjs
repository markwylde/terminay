import assert from 'node:assert/strict';
import test from 'node:test';
import {
	formatNotificationAge,
	notificationHeadline,
} from '../src/workspace/notificationText.ts';

test('headlines say what happened, in agent or terminal words', () => {
	assert.equal(notificationHeadline('done', true), 'Agent finished');
	assert.equal(
		notificationHeadline('waiting', true),
		'Agent is waiting for you',
	);
	assert.equal(notificationHeadline('blocked', true), 'Agent is blocked');
	assert.equal(notificationHeadline('done', false), 'Command finished');
	assert.equal(
		notificationHeadline('blocked', false),
		'Terminal needs attention',
	);
});

test('ages step from seconds to days', () => {
	const now = 1_000_000_000;
	const ago = (seconds) => formatNotificationAge(now - seconds * 1000, now);
	assert.equal(ago(0), 'Just now');
	assert.equal(ago(4), 'Just now');
	assert.equal(ago(23), '23 seconds ago');
	assert.equal(ago(60), '1 minute ago');
	assert.equal(ago(59 * 60), '59 minutes ago');
	assert.equal(ago(60 * 60), '1 hour ago');
	assert.equal(ago(23 * 60 * 60), '23 hours ago');
	assert.equal(ago(49 * 60 * 60), '2 days ago');
});

test('an unknown or future time is handled without a wrong claim', () => {
	assert.equal(formatNotificationAge(undefined, 1_000), null);
	assert.equal(formatNotificationAge(Number.NaN, 1_000), null);
	assert.equal(formatNotificationAge(5_000, 1_000), 'Just now');
});
