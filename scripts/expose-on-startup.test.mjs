import assert from 'node:assert/strict';
import test from 'node:test';
import { exposeOnStartup } from '../electron/remote/exposeOnStartup.ts';
import { normalizeTerminalSettings } from '../src/terminalSettings.ts';

function createExposure(isRunning) {
	return {
		toggles: 0,
		getStatus: async () => ({ isRunning }),
		async toggle() {
			this.toggles += 1;
		},
	};
}

test('exposes a stopped server when the setting is on', async () => {
	const exposure = createExposure(false);
	assert.equal(await exposeOnStartup(true, exposure), true);
	assert.equal(exposure.toggles, 1);
});

test('leaves the server unexposed when the setting is off', async () => {
	const exposure = createExposure(false);
	assert.equal(await exposeOnStartup(false, exposure), false);
	assert.equal(exposure.toggles, 0);
});

test('never toggles an already exposed server off', async () => {
	const exposure = createExposure(true);
	assert.equal(await exposeOnStartup(true, exposure), false);
	assert.equal(exposure.toggles, 0);
});

test('the setting defaults to off and accepts only booleans', () => {
	assert.equal(
		normalizeTerminalSettings({}).remoteAccess.exposeOnStartup,
		false,
	);
	assert.equal(
		normalizeTerminalSettings({ remoteAccess: { exposeOnStartup: 'yes' } })
			.remoteAccess.exposeOnStartup,
		false,
	);
	assert.equal(
		normalizeTerminalSettings({ remoteAccess: { exposeOnStartup: true } })
			.remoteAccess.exposeOnStartup,
		true,
	);
});
