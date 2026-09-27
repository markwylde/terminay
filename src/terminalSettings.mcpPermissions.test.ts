import assert from 'node:assert/strict';
import test from 'node:test';
import {
	defaultTerminalSettings,
	normalizeTerminalSettings,
	terminalSettingsSections,
} from './terminalSettings.ts';

test('MCP permissions default to frictionless terminals and asking before managing automations', () => {
	assert.deepEqual(defaultTerminalSettings.terminayMcp.permissions, {
		terminalsRead: 'allow',
		terminalsManage: 'allow',
		automationsRead: 'allow',
		automationsManage: 'ask',
	});
	// A stored setting from before permissions existed gains the defaults.
	const upgraded = normalizeTerminalSettings({ terminayMcp: { enabled: false } });
	assert.equal(upgraded.terminayMcp.enabled, false);
	assert.deepEqual(upgraded.terminayMcp.permissions, defaultTerminalSettings.terminayMcp.permissions);
	const chosen = normalizeTerminalSettings({
		terminayMcp: { enabled: true, permissions: { terminalsManage: 'ask', automationsRead: 'deny', automationsManage: 'always' } },
	});
	assert.deepEqual(chosen.terminayMcp.permissions, {
		terminalsRead: 'allow',
		terminalsManage: 'ask',
		automationsRead: 'deny',
		automationsManage: 'ask',
	});
});

test('Settings > AI > Terminay MCP lists the four permission groups with three choices each', () => {
	const section = terminalSettingsSections.find((candidate) => candidate.id === 'terminay-mcp');
	assert.ok(section);
	const rows = section.fields
		.filter((field) => field.key.startsWith('terminayMcp.permissions.'))
		.map((field) => [field.label, field.input, field.options?.map((option) => option.label)]);
	const choices = ['Ask Permission', 'Always Allow', 'Never Allow'];
	assert.deepEqual(rows, [
		['Read Terminals', 'select', choices],
		['Full Terminal Management', 'select', choices],
		['Read Automations', 'select', choices],
		['Full Automation Management', 'select', choices],
	]);
});
