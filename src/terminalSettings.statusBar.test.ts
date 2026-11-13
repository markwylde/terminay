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
	terminalSettingsSections,
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

test('host stats are off by default with a five-second interval', () => {
	assert.deepEqual(defaultTerminalSettings.hostStats, { enabled: false, intervalSeconds: 5 });
	assert.deepEqual(normalizeTerminalSettings({}).hostStats, { enabled: false, intervalSeconds: 5 });
	assert.deepEqual(
		normalizeTerminalSettings({ hostStats: { enabled: 'yes', intervalSeconds: 'x' } }).hostStats,
		{ enabled: false, intervalSeconds: 5 },
	);
});

test('the host stats interval is whole seconds from 1 to 3600', () => {
	const interval = (value: unknown) =>
		normalizeTerminalSettings({ hostStats: { enabled: true, intervalSeconds: value } })
			.hostStats.intervalSeconds;
	assert.equal(interval(2), 2);
	assert.equal(interval(0), 1);
	assert.equal(interval(2.4), 2);
	assert.equal(interval(100_000), 3600);
	assert.equal(
		normalizeTerminalSettings({ hostStats: { enabled: true, intervalSeconds: 2 } }).hostStats.enabled,
		true,
	);
});

test('host stats are a device-local setting shown under Appearance > Status Bar', () => {
	const device = selectDeviceTerminalSettings({
		...defaultTerminalSettings,
		hostStats: { enabled: true, intervalSeconds: 2 },
	});
	assert.deepEqual(device.hostStats, { enabled: true, intervalSeconds: 2 });
	const section = terminalSettingsSections.find((entry) => entry.id === 'status-bar');
	assert.equal(section?.categoryId, 'appearance');
	const interval = section?.fields.find((field) => field.key === 'hostStats.intervalSeconds');
	assert.deepEqual(interval?.visibleWhen, { key: 'hostStats.enabled', value: true });
	assert.equal(interval?.min, 1);
	assert.equal(interval?.max, 3600);
});
