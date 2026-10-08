import assert from 'node:assert/strict';
import test from 'node:test';
import {
	pairingTargetWindow,
	switchWindowServer,
} from '../electron/windowServerSwitch.ts';

function harness(overrides = {}) {
	const steps = [];
	const options = {
		profileId: 'remote:a',
		currentProfileId: 'local',
		localProfileId: 'local',
		isRemembered: (id) => id === 'remote:a' || id === 'remote:b',
		connectRemote: async (id) => {
			steps.push(`connect:${id}`);
			return { transport: id };
		},
		mountRemote: async (id, remote) => {
			steps.push(`mount:${id}:${remote.transport}`);
		},
		discardRemote: async (remote) => {
			steps.push(`discard:${remote.transport}`);
		},
		mountLocal: async () => {
			steps.push('mount:local');
		},
		beforeMount: () => steps.push('before-mount'),
		...overrides,
	};
	return { steps, run: () => switchWindowServer(options) };
}

test('a window switches to a remote server only once its transport is open', async () => {
	const { steps, run } = harness();
	assert.equal(await run(), 'switched');
	// Nothing of the window is touched before the server answers.
	assert.deepEqual(steps, [
		'connect:remote:a',
		'before-mount',
		'mount:remote:a:remote:a',
	]);
});

test('a server that cannot be reached leaves the window as it was', async () => {
	const { steps, run } = harness({
		connectRemote: async () => {
			throw new Error('The server did not answer.');
		},
	});
	await assert.rejects(run(), /did not answer/u);
	assert.deepEqual(steps, []);
});

test('a transport that was opened and not used is closed', async () => {
	const { steps, run } = harness({
		mountRemote: async () => {
			throw new Error('The workspace failed to load.');
		},
	});
	await assert.rejects(run(), /failed to load/u);
	assert.deepEqual(steps, [
		'connect:remote:a',
		'before-mount',
		'discard:remote:a',
	]);
});

test('returning to Local opens no transport', async () => {
	const { steps, run } = harness({
		profileId: 'local',
		currentProfileId: 'remote:a',
	});
	assert.equal(await run(), 'switched');
	assert.deepEqual(steps, ['before-mount', 'mount:local']);
});

test('choosing the server a window already shows changes nothing', async () => {
	for (const profileId of ['local', 'remote:a']) {
		const { steps, run } = harness({ profileId, currentProfileId: profileId });
		assert.equal(await run(), 'unchanged');
		assert.deepEqual(steps, []);
	}
});

test('a server that was forgotten is refused before anything is opened', async () => {
	const { steps, run } = harness({ profileId: 'remote:gone' });
	await assert.rejects(run(), /no longer saved/u);
	assert.deepEqual(steps, []);
});

test('a paired server is shown in the workspace window, never in Remote Control', () => {
	// Remote Control paired it: its parent workspace window shows it.
	assert.equal(
		pairingTargetWindow({
			pairingWindow: 'remote-control',
			pairingWindowIsAuxiliary: true,
			parentWindow: 'workspace',
		}),
		'workspace',
	);
	// The workspace window has since closed: nothing is switched.
	assert.equal(
		pairingTargetWindow({
			pairingWindow: 'remote-control',
			pairingWindowIsAuxiliary: true,
			parentWindow: undefined,
		}),
		undefined,
	);
	// A workspace window that pairs shows the server itself.
	assert.equal(
		pairingTargetWindow({
			pairingWindow: 'workspace',
			pairingWindowIsAuxiliary: false,
			parentWindow: undefined,
		}),
		'workspace',
	);
});
