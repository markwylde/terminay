import assert from 'node:assert/strict';
import test from 'node:test';
import { embeddedNotificationSettleMsOverride } from '../electron/testTerminalLimits.ts';

/**
 * The E2E-only settle period override is inert in production. It exists so
 * the end-to-end suite does not wait five seconds every time it reads the
 * header Notifications count.
 */

test('the override applies only alongside the E2E marker', () => {
	assert.equal(
		embeddedNotificationSettleMsOverride({
			TERMINAY_TEST: '1',
			TERMINAY_TEST_NOTIFICATION_SETTLE_MS: '300',
		}),
		300,
	);
	assert.equal(
		embeddedNotificationSettleMsOverride({
			TERMINAY_TEST_NOTIFICATION_SETTLE_MS: '300',
		}),
		undefined,
		'a production process ignores the variable',
	);
	assert.equal(
		embeddedNotificationSettleMsOverride({
			TERMINAY_TEST: 'yes',
			TERMINAY_TEST_NOTIFICATION_SETTLE_MS: '300',
		}),
		undefined,
		'only the exact marker counts',
	);
});

test('zero is allowed, and anything but whole milliseconds up to a minute is rejected', () => {
	assert.equal(
		embeddedNotificationSettleMsOverride({ TERMINAY_TEST: '1' }),
		undefined,
	);
	const settle = (value) =>
		embeddedNotificationSettleMsOverride({
			TERMINAY_TEST: '1',
			TERMINAY_TEST_NOTIFICATION_SETTLE_MS: value,
		});
	assert.equal(settle('0'), 0);
	assert.equal(settle('60000'), 60_000);
	for (const value of ['-1', '1.5', '5s', '', ' 300', '1e3', '60001', '999999'])
		assert.equal(settle(value), undefined, JSON.stringify(value));
});
