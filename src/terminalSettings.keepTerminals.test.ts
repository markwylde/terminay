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
	.find((candidate) => candidate.key === 'keepTerminalsAfterQuit');

test('the keep-terminals setting is offered under shell lifecycle and defaults to 5 minutes', () => {
	assert.ok(field, 'the setting has no control');
	assert.equal(field.sectionId, 'shell-lifecycle');
	assert.equal(field.input, 'select');
	assert.equal(defaultTerminalSettings.keepTerminalsAfterQuit, '5m');
	const options = field.options ?? [];
	assert.deepEqual(
		options.map((option) => option.value),
		['1m', '5m', '30m', '2h', 'untilRestart'],
	);
	// The default the control shows is the option a user reads as "5 minutes".
	assert.equal(
		options.find(
			(option) => option.value === defaultTerminalSettings.keepTerminalsAfterQuit,
		)?.label,
		'5 minutes',
	);
	assert.ok(
		options.some((option) => /restarts/.test(option.label)),
		'no value keeps terminals until the machine restarts',
	);
});

test('a chosen value is kept and anything else falls back to the default', () => {
	for (const value of ['1m', '5m', '30m', '2h', 'untilRestart'] as const)
		assert.equal(
			normalizeTerminalSettings({
				...defaultTerminalSettings,
				keepTerminalsAfterQuit: value,
			}).keepTerminalsAfterQuit,
			value,
		);
	for (const value of [undefined, 'forever', 5, null])
		assert.equal(
			normalizeTerminalSettings({
				...defaultTerminalSettings,
				keepTerminalsAfterQuit: value as never,
			}).keepTerminalsAfterQuit,
			'5m',
		);
});

test('the setting is server-owned, so Desktop never stores it on the device', () => {
	const device = selectDeviceTerminalSettings({
		...defaultTerminalSettings,
		keepTerminalsAfterQuit: '2h',
	});
	assert.equal('keepTerminalsAfterQuit' in device, false);
});
