import assert from 'node:assert/strict';
import test from 'node:test';
import {
	classifySetting,
	DEFAULT_SERVER_SETTINGS,
	MCP_REACHABLE_SETTING_PATHS,
	normalizeSettingsAndSecrets,
} from '../dist/settings/index.js';

// ADR-0101: the Home overview layout is a server setting, and MCP cannot reach it.

test('the Home overview layout is a server setting with an empty default', () => {
	assert.equal(classifySetting('homeDashboard'), 'server');
	assert.equal(classifySetting('homeDashboard.widgets'), 'server');
	assert.deepEqual(DEFAULT_SERVER_SETTINGS.homeDashboard, { widgets: [] });
});

test('the Home overview layout is not reachable through MCP settings', () => {
	assert.equal(MCP_REACHABLE_SETTING_PATHS.includes('homeDashboard'), false);
});

test('a stored layout survives server normalisation unchanged', () => {
	const widgets = [
		{ id: 'workflows', size: 'wide', hidden: false },
		{ id: 'from-the-future', size: 'tall', hidden: true },
	];
	const { settings } = normalizeSettingsAndSecrets({
		homeDashboard: { widgets },
	});
	assert.deepEqual(settings.homeDashboard, { widgets });
});
