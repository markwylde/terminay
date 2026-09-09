import assert from 'node:assert/strict';
import test from 'node:test';
import { embeddedTerminalReplayBytesOverride } from '../electron/testTerminalLimits.ts';

/**
 * The E2E-only replay window override is inert in production. It exists so an
 * end-to-end test can make a shell outrun the retained window during a real
 * Local transport loss, which a production-sized window cannot do in the
 * sub-second gap Local recovery leaves.
 */

test('the override applies only alongside the E2E marker', () => {
	assert.equal(
		embeddedTerminalReplayBytesOverride({
			TERMINAY_TEST: '1',
			TERMINAY_TEST_TERMINAL_REPLAY_BYTES: '16384',
		}),
		16_384,
	);
	assert.equal(
		embeddedTerminalReplayBytesOverride({
			TERMINAY_TEST_TERMINAL_REPLAY_BYTES: '16384',
		}),
		undefined,
		'a production process ignores the variable',
	);
	assert.equal(
		embeddedTerminalReplayBytesOverride({
			TERMINAY_TEST: 'yes',
			TERMINAY_TEST_TERMINAL_REPLAY_BYTES: '16384',
		}),
		undefined,
		'only the exact marker counts',
	);
});

test('the override is absent without a value and rejects anything but a positive safe integer', () => {
	assert.equal(embeddedTerminalReplayBytesOverride({ TERMINAY_TEST: '1' }), undefined);
	for (const value of ['0', '-1', '1.5', '16k', '', ' 16384', '1e5', '9007199254740993']) {
		assert.equal(
			embeddedTerminalReplayBytesOverride({
				TERMINAY_TEST: '1',
				TERMINAY_TEST_TERMINAL_REPLAY_BYTES: value,
			}),
			undefined,
			JSON.stringify(value),
		);
	}
});
