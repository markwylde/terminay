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
	.find((candidate) => candidate.key === 'shellIntegration');

test('shell integration is a toggle under Shell that is on by default', () => {
	assert.ok(field, 'the setting has no control');
	assert.equal(field.input, 'boolean');
	assert.equal(field.label, 'Shell integration');
	assert.equal(field.categoryId, 'shell');
	assert.equal(defaultTerminalSettings.shellIntegration, true);
	const section = terminalSettingsSections.find(
		(candidate) => candidate.id === field.sectionId,
	);
	assert.equal(section?.title, 'Shell integration');
});

test('a chosen value is kept and anything else falls back to on', () => {
	for (const value of [true, false])
		assert.equal(
			normalizeTerminalSettings({
				...defaultTerminalSettings,
				shellIntegration: value,
			}).shellIntegration,
			value,
		);
	for (const value of [undefined, 'off', 0, null])
		assert.equal(
			normalizeTerminalSettings({
				...defaultTerminalSettings,
				shellIntegration: value as never,
			}).shellIntegration,
			true,
		);
});

test('the setting is server-owned, so a device never stores it', () => {
	const device = selectDeviceTerminalSettings({
		...defaultTerminalSettings,
		shellIntegration: false,
	});
	assert.equal('shellIntegration' in device, false);
});
