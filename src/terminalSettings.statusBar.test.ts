import assert from 'node:assert/strict';
import test from 'node:test';
import {
	defaultKeyboardShortcuts,
	appCommandMetadata,
} from './keyboardShortcuts.ts';
import {
	defaultTerminalSettings,
	normalizeTerminalSettings,
	selectDeviceTerminalSettings,
} from './terminalSettings.ts';

test('the status bar is shown by default', () => {
	assert.equal(defaultTerminalSettings.showStatusBar, true);
	// A stored setting from before the status bar existed shows it.
	assert.equal(normalizeTerminalSettings({}).showStatusBar, true);
	assert.equal(normalizeTerminalSettings({ showStatusBar: 'no' }).showStatusBar, true);
});

test('a hidden status bar survives normalisation', () => {
	assert.equal(normalizeTerminalSettings({ showStatusBar: false }).showStatusBar, false);
});

test('the status bar is hidden by default in compact chrome', () => {
	assert.equal(defaultTerminalSettings.showStatusBarCompact, false);
	assert.equal(normalizeTerminalSettings({}).showStatusBarCompact, false);
	assert.equal(
		normalizeTerminalSettings({ showStatusBarCompact: 'yes' })
			.showStatusBarCompact,
		false,
	);
	assert.equal(
		normalizeTerminalSettings({ showStatusBarCompact: true })
			.showStatusBarCompact,
		true,
	);
});

test('status bar visibility is a device-local setting', () => {
	const device = selectDeviceTerminalSettings({
		...defaultTerminalSettings,
		showStatusBar: false,
		showStatusBarCompact: true,
	});
	assert.equal(device.showStatusBar, false);
	assert.equal(device.showStatusBarCompact, true);
});

test('Show Status Bar is a rebindable command with no default accelerator', () => {
	assert.equal(defaultKeyboardShortcuts['toggle-status-bar'], '');
	assert.ok(
		appCommandMetadata.some((entry) => entry.command === 'toggle-status-bar'),
	);
});
