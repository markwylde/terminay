import assert from 'node:assert/strict';
import test from 'node:test';
import {
	controlLine,
	controlWasTaken,
	serverDesktopButtonLabel,
	serverDesktopTitle,
	setupAction,
	setupPercent,
	setupStepStates,
	turnOffConfirmation,
} from './serverDesktopModel.ts';

const laptop = { clientId: 'laptop', deviceName: 'Laptop' };

test('the steps before the current one are done and the ones after are pending', () => {
	assert.deepEqual(
		setupStepStates('downloading').map((entry) => [entry.step, entry.state]),
		[
			['waiting', 'done'],
			['preparing', 'done'],
			['downloading', 'current'],
			['installing', 'pending'],
			['starting', 'pending'],
		],
	);
	assert.deepEqual(
		setupStepStates('installing', true).map((entry) => entry.state),
		['done', 'done', 'done', 'failed', 'pending'],
	);
	assert.ok(
		setupStepStates(undefined).every((entry) => entry.state === 'pending'),
	);
});

test('progress is a whole percentage inside its range', () => {
	assert.equal(setupPercent(0.456), 46);
	assert.equal(setupPercent(-1), 0);
	assert.equal(setupPercent(7), 100);
	assert.equal(setupPercent(Number.NaN), 0);
});

test('the control line says who has the desktop', () => {
	assert.equal(controlLine('control', laptop), 'You control this desktop.');
	assert.equal(
		controlLine('view-only', laptop),
		'Viewing. Laptop controls this desktop.',
	);
	assert.equal(
		controlLine('view-only', { clientId: 'x', deviceName: '  ' }),
		'Viewing. Another device controls this desktop.',
	);
	assert.equal(
		controlLine('view-only', null),
		'Viewing. Nobody controls this desktop.',
	);
	assert.equal(controlLine(undefined, null), 'Opening the desktop…');
});

test('control was taken only when this device held it, did not ask, and someone else has it', () => {
	const held = {
		mode: 'control' as const,
		ownClientId: 'me',
		requesting: false,
	};
	assert.equal(controlWasTaken({ ...held, controller: laptop }), true);
	// This device's own controller, announced back to it.
	assert.equal(
		controlWasTaken({
			...held,
			controller: { clientId: 'me', deviceName: 'Phone' },
		}),
		false,
	);
	// Its own request in flight, a viewer, and nobody controlling.
	assert.equal(
		controlWasTaken({ ...held, requesting: true, controller: laptop }),
		false,
	);
	assert.equal(
		controlWasTaken({ ...held, mode: 'view-only', controller: laptop }),
		false,
	);
	assert.equal(controlWasTaken({ ...held, controller: null }), false);
	assert.equal(
		controlWasTaken({ ...held, ownClientId: undefined, controller: laptop }),
		false,
	);
});

test('turning off names how many program windows would close', () => {
	assert.match(turnOffConfirmation(1), /^1 program window is open/);
	assert.match(turnOffConfirmation(3), /^3 program windows are open/);
	assert.match(turnOffConfirmation(undefined), /^Programs open on the desktop/);
});

test('what can be asked of the server follows its state and how setup runs here', () => {
	const command = 'sudo terminay daemon desktop install';
	assert.equal(
		setupAction({ state: 'needs-setup', setup: 'server', command }),
		'setup',
	);
	assert.equal(
		setupAction({ state: 'needs-setup', setup: 'command', command }),
		'command',
	);
	assert.equal(
		setupAction({
			state: 'failed',
			step: 'downloading',
			reason: 'x',
			setup: 'server',
			command,
		}),
		'setup',
	);
	assert.equal(
		setupAction({
			state: 'failed',
			step: 'installing',
			reason: 'x',
			setup: 'command',
			command,
		}),
		'command',
	);
	// The desktop's start failed, not its setup: ask again.
	assert.equal(
		setupAction({ state: 'failed', reason: 'x', setup: 'server', command }),
		'check',
	);
	assert.equal(
		setupAction({
			state: 'unsupported',
			reason: 'not-debian',
			message: 'x',
		}),
		'none',
	);
	assert.equal(setupAction({ state: 'off' }), 'none');
	assert.equal(
		setupAction({ state: 'setting-up', step: 'waiting', fraction: 0 }),
		'none',
	);
});

test('the control and the window name the server, not a project', () => {
	assert.equal(serverDesktopButtonLabel('VPS'), 'Show desktop of VPS');
	assert.equal(serverDesktopTitle('VPS'), 'Desktop · VPS');
});
