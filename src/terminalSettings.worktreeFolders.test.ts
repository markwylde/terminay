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
	.find((candidate) => candidate.key === 'moveTerminalsIntoNewWorktreeFolders');

test('moving terminals into new worktree folders is a toggle that is on by default', () => {
	assert.ok(field, 'the setting has no control');
	assert.equal(field.input, 'boolean');
	assert.equal(field.label, 'Move terminals into new worktree folders');
	assert.equal(
		field.description,
		"When a terminal creates a Git worktree, move it into that worktree's folder. When off, the folder offers the move instead.",
	);
	assert.equal(defaultTerminalSettings.moveTerminalsIntoNewWorktreeFolders, true);
	// It sits with the other toggles that say what happens to a terminal.
	const lifecycle = terminalSettingsSections.find(
		(section) => section.id === field.sectionId,
	);
	assert.ok(
		lifecycle?.fields.some(
			(candidate) => candidate.key === 'autoCloseTerminalOnExitZero',
		),
	);
});

test('a chosen value is kept and anything else falls back to on', () => {
	for (const value of [true, false])
		assert.equal(
			normalizeTerminalSettings({
				...defaultTerminalSettings,
				moveTerminalsIntoNewWorktreeFolders: value,
			}).moveTerminalsIntoNewWorktreeFolders,
			value,
		);
	for (const value of [undefined, 'off', 0, null])
		assert.equal(
			normalizeTerminalSettings({
				...defaultTerminalSettings,
				moveTerminalsIntoNewWorktreeFolders: value as never,
			}).moveTerminalsIntoNewWorktreeFolders,
			true,
		);
});

test('the setting is server-owned, so Desktop never stores it on the device', () => {
	const device = selectDeviceTerminalSettings({
		...defaultTerminalSettings,
		moveTerminalsIntoNewWorktreeFolders: false,
	});
	assert.equal('moveTerminalsIntoNewWorktreeFolders' in device, false);
});
