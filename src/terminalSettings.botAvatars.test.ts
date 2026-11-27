import assert from 'node:assert/strict';
import test from 'node:test';

import {
	defaultTerminalSettings,
	normalizeTerminalSettings,
	selectDeviceTerminalSettings,
	terminalSettingsSections,
} from './terminalSettings.ts';

const field = terminalSettingsSections
	.flatMap((section) => section.fields)
	.find((candidate) => candidate.key === 'animateBotAvatars');

test('animating bot avatars is an accessibility toggle that is on by default', () => {
	assert.ok(field, 'the setting has no control');
	assert.equal(field.input, 'boolean');
	assert.equal(field.label, 'Animate bot avatars');
	assert.equal(field.categoryId, 'accessibility');
	assert.equal(defaultTerminalSettings.animateBotAvatars, true);
});

test('a chosen value is kept and anything else falls back to on', () => {
	for (const value of [true, false])
		assert.equal(
			normalizeTerminalSettings({
				...defaultTerminalSettings,
				animateBotAvatars: value,
			}).animateBotAvatars,
			value,
		);
	for (const value of [undefined, 'off', 0, null])
		assert.equal(
			normalizeTerminalSettings({
				...defaultTerminalSettings,
				animateBotAvatars: value as never,
			}).animateBotAvatars,
			true,
		);
});

test('the setting belongs to the device', () => {
	const device = selectDeviceTerminalSettings({
		...defaultTerminalSettings,
		animateBotAvatars: false,
	});
	assert.equal(device.animateBotAvatars, false);
});
