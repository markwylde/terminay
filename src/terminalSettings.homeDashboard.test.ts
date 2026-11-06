import assert from 'node:assert/strict';
import test from 'node:test';
import {
	defaultTerminalSettings,
	normalizeHomeDashboardSettings,
	normalizeTerminalSettings,
	selectDeviceTerminalSettings,
} from './terminalSettings.ts';

test('the Home overview layout defaults to empty, which is the default layout', () => {
	assert.deepEqual(defaultTerminalSettings.homeDashboard, { widgets: [] });
	assert.deepEqual(normalizeTerminalSettings({}).homeDashboard, {
		widgets: [],
	});
	assert.deepEqual(normalizeHomeDashboardSettings('nope'), { widgets: [] });
	assert.deepEqual(normalizeHomeDashboardSettings({ widgets: 3 }), {
		widgets: [],
	});
});

test('malformed entries are dropped and a repeated id keeps its first entry', () => {
	assert.deepEqual(
		normalizeHomeDashboardSettings({
			widgets: [
				{ id: 'bots', size: 'wide', hidden: false },
				{ id: 'bots', size: 'small', hidden: true },
				{ id: 'Bad Id', size: 'small', hidden: false },
				{ id: 'tabs', size: 'huge', hidden: false },
				{ id: 'recordings', size: 'small' },
				null,
				{ id: 'tabs', size: 'tall', hidden: true },
			],
		}),
		{
			widgets: [
				{ id: 'bots', size: 'wide', hidden: false },
				{ id: 'tabs', size: 'tall', hidden: true },
			],
		},
	);
});

test('an id this client does not know is kept', () => {
	const widgets = [{ id: 'from-the-future', size: 'small', hidden: false }];
	assert.deepEqual(normalizeHomeDashboardSettings({ widgets }), { widgets });
});

test('the Home overview layout never enters the device store', () => {
	const device = selectDeviceTerminalSettings({
		...defaultTerminalSettings,
		homeDashboard: { widgets: [{ id: 'bots', size: 'wide', hidden: true }] },
	});
	assert.equal('homeDashboard' in device, false);
});
