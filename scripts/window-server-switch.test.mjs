import assert from 'node:assert/strict';
import test from 'node:test';
import {
	openStartupWindowServer,
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

function startup(overrides = {}) {
	const steps = [];
	let requestLocal = () => undefined;
	const options = {
		rememberedProfileId: 'remote:a',
		localProfileId: 'local',
		isRemembered: (id) => id === 'remote:a',
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
		localRequested: new Promise((resolve) => {
			requestLocal = resolve;
		}),
		offerLocalAfterMs: 60_000,
		offerLocal: () => steps.push('offer-local'),
		beforeMount: () => steps.push('before-mount'),
		...overrides,
	};
	return {
		steps,
		requestLocal: () => requestLocal(),
		run: () => openStartupWindowServer(options),
	};
}

test('startup opens straight onto the remembered server and never mounts Local', async () => {
	const { steps, run } = startup();
	assert.equal(await run(), 'remote');
	assert.deepEqual(steps, [
		'connect:remote:a',
		'before-mount',
		'mount:remote:a:remote:a',
	]);
});

test('startup opens on Local when Local, nothing, or a forgotten server was remembered', async () => {
	for (const rememberedProfileId of [undefined, 'local', 'remote:forgotten']) {
		const { steps, run } = startup({ rememberedProfileId });
		assert.equal(await run(), 'local');
		assert.deepEqual(steps, ['before-mount', 'mount:local']);
	}
});

test('startup opens on Local when the remembered server does not answer', async () => {
	const { steps, run } = startup({
		connectRemote: async () => {
			throw new Error('The server did not answer.');
		},
	});
	assert.equal(await run(), 'local');
	assert.deepEqual(steps, ['before-mount', 'mount:local']);
});

test('startup falls back to Local and closes the transport when the server workspace fails to load', async () => {
	const { steps, run } = startup({
		mountRemote: async () => {
			throw new Error('The workspace failed to load.');
		},
	});
	assert.equal(await run(), 'local');
	assert.deepEqual(steps, [
		'connect:remote:a',
		'before-mount',
		'discard:remote:a',
		'mount:local',
	]);
});

test('a server that answers promptly never offers Local', async () => {
	const { steps, run } = startup({ offerLocalAfterMs: 20 });
	await run();
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.ok(!steps.includes('offer-local'));
});

test('a slow server offers Local, and choosing it abandons the attempt', async () => {
	let answer = () => undefined;
	const { steps, run, requestLocal } = startup({
		offerLocalAfterMs: 10,
		connectRemote: (id) =>
			new Promise((resolve) => {
				answer = () => resolve({ transport: id });
			}),
	});
	const opening = run();
	await new Promise((resolve) => setTimeout(resolve, 40));
	// Nothing is mounted while the server is merely slow.
	assert.deepEqual(steps, ['offer-local']);
	requestLocal();
	assert.equal(await opening, 'local-requested');
	assert.deepEqual(steps, ['offer-local', 'before-mount', 'mount:local']);
	// A transport that opens after the choice is closed, never mounted.
	answer();
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.deepEqual(steps, [
		'offer-local',
		'before-mount',
		'mount:local',
		'discard:remote:a',
	]);
});
