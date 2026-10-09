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
	.find((candidate) => candidate.key === 'programSetTabTitles');

test('letting programs set tab titles is a toggle that is on by default', () => {
	assert.ok(field, 'the setting has no control');
	assert.equal(field.input, 'boolean');
	assert.equal(field.label, 'Let programs set tab titles');
	assert.equal(defaultTerminalSettings.programSetTabTitles, true);
	// It sits with the other toggles that say how a terminal behaves.
	const section = terminalSettingsSections.find(
		(candidate) => candidate.id === field.sectionId,
	);
	assert.ok(
		section?.fields.some(
			(candidate) => candidate.key === 'autoCloseTerminalOnExitZero',
		),
	);
});

test('a chosen value is kept and anything else falls back to on', () => {
	for (const value of [true, false])
		assert.equal(
			normalizeTerminalSettings({
				...defaultTerminalSettings,
				programSetTabTitles: value,
			}).programSetTabTitles,
			value,
		);
	for (const value of [undefined, 'off', 0, null])
		assert.equal(
			normalizeTerminalSettings({
				...defaultTerminalSettings,
				programSetTabTitles: value as never,
			}).programSetTabTitles,
			true,
		);
});

test('the setting is server-owned, so a device never stores it', () => {
	const device = selectDeviceTerminalSettings({
		...defaultTerminalSettings,
		programSetTabTitles: false,
	});
	assert.equal('programSetTabTitles' in device, false);
});
