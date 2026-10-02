import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { requiredLaneClosed } from '../apps/terminay-server/src/remote/hostedPeerLifecycle.ts';
import {
	DESKTOP_PAIRING_ATTEMPT_CANCELLED_MESSAGE,
	DesktopPairingAttempts,
	runDesktopPairingAttempt,
} from '../electron/remote/desktopPairingAttempt.ts';
import { friendlyPairingActionError } from '../src/shared/pairingActionError.ts';
import {
	IDLE_PAIRING_ATTEMPT,
	pairingAttemptReducer,
} from '../src/shared/pairingAttemptState.ts';

/**
 * A Desktop pairing attempt is a sequence the user watches: match code,
 * approval, connecting, connected — or a failure they can act on. These tests
 * drive that sequence through the same module Electron's main process runs, and
 * through the reducer and component the pairing surface renders from.
 */

const require = createRequire(import.meta.url);
const directory = await mkdtemp(
	join(process.cwd(), '.desktop-pairing-attempt-test-'),
);
const statusOut = join(directory, 'pairing-attempt-status.cjs');
await build({
	entryPoints: ['src/shared/PairingAttemptStatus.tsx'],
	outfile: statusOut,
	bundle: true,
	format: 'cjs',
	jsx: 'automatic',
	platform: 'node',
	external: ['react', 'react/jsx-runtime'],
	logLevel: 'silent',
});
const { PairingAttemptStatus, PAIRING_CONNECTION_LOST_COPY } =
	require(statusOut);
test.after(async () => rm(directory, { recursive: true, force: true }));

const PROFILE = Object.freeze({ id: 'remote:1', origin: 'https://box.test' });

/** One attempt wired to scripted collaborators, recording everything it does. */
function attempt(overrides = {}) {
	const log = [];
	const controller = new AbortController();
	const hooks = {};
	const run = runDesktopPairingAttempt({
		abort: controller.signal,
		enroll: async (enrollHooks) => {
			hooks.enroll = enrollHooks;
			log.push('enroll');
			return PROFILE;
		},
		rememberProfile: (profile) => log.push(`remember:${profile.id}`),
		connect: async (_profile, connectHooks) => {
			hooks.connect = connectHooks;
			log.push('connect');
			return { launch: 'launch' };
		},
		mount: async () => {
			log.push('mount');
		},
		onLoadFailed: (profile) => log.push(`load-failed:${profile.id}`),
		emitApproval: (approval) => log.push(`approval:${approval.matchCode}`),
		emitProgress: (state) => log.push(`progress:${state}`),
		...overrides,
	});
	return { controller, hooks, log, run };
}

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

test('a successful attempt saves the profile before reconnecting and reports each phase once', async () => {
	const { log, run } = attempt();
	await run;
	assert.deepEqual(log, [
		'enroll',
		'remember:remote:1',
		'progress:connecting',
		'connect',
		'mount',
		'progress:connected',
	]);
});

test('the enrolled profile stays saved when the first reconnect fails, and the loss is reported once', async () => {
	const { log, run } = attempt({
		connect: async (_profile, hooks) => {
			// The peer monitor and the rejected request both report the same loss.
			hooks.onConnectionFailure();
			throw new Error('The server did not answer in time.');
		},
	});
	await assert.rejects(run, /did not answer in time/u);
	assert.deepEqual(log, [
		'enroll',
		'remember:remote:1',
		'progress:connecting',
		'progress:connection-lost',
		'load-failed:remote:1',
	]);
});

test('the enrolled profile stays saved when the workspace bundle fails to mount', async () => {
	const { log, run } = attempt({
		mount: async () => {
			throw new Error('bundle integrity check failed');
		},
	});
	await assert.rejects(run, /bundle integrity/u);
	assert.deepEqual(log, [
		'enroll',
		'remember:remote:1',
		'progress:connecting',
		'connect',
		'load-failed:remote:1',
		'progress:connection-lost',
	]);
});

test('a failure before enrollment saves nothing and never claims a saved server', async () => {
	const { log, run } = attempt({
		enroll: async (hooks) => {
			hooks.onMatchCode({ deviceName: 'Desktop', matchCode: 'K7Q2M', expiresAt: 1 });
			hooks.onConnectionStatus('degraded');
			throw new Error('The connection to the server was lost before it answered.');
		},
	});
	await assert.rejects(run, /connection to the server was lost/u);
	assert.deepEqual(log, ['approval:K7Q2M', 'progress:connection-degraded']);
	assert.equal(
		log.some((entry) => /remember|connection-lost|connecting/u.test(entry)),
		false,
		'connection-lost implies a retryable saved server, which does not exist yet',
	);
});

test('a recovered network path returns the surface to the phase the attempt is in', async () => {
	const enrolled = deferred();
	const connected = deferred();
	const mounted = deferred();
	const hooks = {};
	const { log, run } = attempt({
		enroll: async (enrollHooks) => {
			hooks.enroll = enrollHooks;
			return enrolled.promise;
		},
		connect: async (_profile, connectHooks) => {
			hooks.connect = connectHooks;
			return connected.promise;
		},
		mount: () => mounted.promise,
	});
	hooks.enroll.onConnectionStatus('degraded');
	hooks.enroll.onConnectionStatus('recovered');
	enrolled.resolve(PROFILE);
	await new Promise((resolve) => setImmediate(resolve));
	hooks.connect.onConnectionStatus('degraded');
	hooks.connect.onConnectionStatus('recovered');
	connected.resolve({});
	mounted.resolve();
	await run;
	hooks.connect.onConnectionStatus('degraded');
	hooks.connect.onConnectionStatus('recovered');
	assert.deepEqual(
		log.filter((entry) => entry.startsWith('progress:')),
		[
			'progress:connection-degraded',
			'progress:connection-recovered',
			'progress:connecting',
			'progress:connection-degraded',
			'progress:connecting',
			'progress:connected',
			'progress:connection-degraded',
			'progress:connected',
		],
	);
});

test('a connection lost after the workspace mounted is reported once and never un-lost', async () => {
	const { hooks, log, run } = attempt();
	await run;
	hooks.connect.onConnectionFailure();
	hooks.connect.onConnectionFailure();
	hooks.connect.onConnectionStatus('recovered');
	assert.deepEqual(log.slice(-2), [
		'progress:connected',
		'progress:connection-lost',
	]);
});

test('cancelling while waiting for approval rejects the attempt and saves nothing', async () => {
	const { controller, log, run } = attempt({
		enroll: (hooks) =>
			new Promise((_resolve, reject) => {
				hooks.abort.addEventListener('abort', () =>
					reject(new Error('Desktop pairing was cancelled.')),
				);
			}),
	});
	controller.abort();
	await assert.rejects(run, /cancelled/u);
	assert.deepEqual(log, []);
});

test('a cancel that loses the race with approval keeps the saved server but does not switch to it', async () => {
	// The host approved in the same moment the user cancelled.
	const approved = deferred();
	const { controller, log, run } = attempt({
		enroll: () => approved.promise,
	});
	controller.abort();
	approved.resolve(PROFILE);
	await assert.rejects(run, {
		message: DESKTOP_PAIRING_ATTEMPT_CANCELLED_MESSAGE,
	});
	assert.deepEqual(log, ['remember:remote:1']);
});

test('a cancellation aborts only the attempt it names', () => {
	const attempts = new DesktopPairingAttempts();
	const first = attempts.begin('pair-1');
	const second = attempts.begin('pair-2');
	assert.equal(attempts.cancel('pair-unknown'), false);
	assert.equal(attempts.cancel('pair-1'), true);
	assert.equal(first.aborted, true);
	assert.equal(second.aborted, false);
	// A finished attempt is forgotten, so a late cancel for it is a no-op.
	attempts.end('pair-2', second);
	assert.equal(attempts.cancel('pair-2'), false);
	assert.equal(second.aborted, false);
	const third = attempts.begin('pair-3');
	// Ending with a stale signal must not forget the attempt that replaced it.
	attempts.end('pair-3', first);
	attempts.cancelAll();
	assert.equal(third.aborted, true);
});

const APPROVAL = Object.freeze({
	deviceName: 'Terminay Desktop',
	matchCode: 'K7Q2M',
	expiresAt: '2026-10-02T07:30:00.000Z',
});

function reduce(...events) {
	return events.reduce(pairingAttemptReducer, IDLE_PAIRING_ATTEMPT);
}

test('the pairing surface follows the attempt from match code to connected', () => {
	const started = { type: 'started', attemptId: 'pair-1' };
	const approval = { type: 'approval', attemptId: 'pair-1', approval: APPROVAL };
	const progress = (state) => ({ type: 'progress', attemptId: 'pair-1', state });

	const waiting = reduce(started, approval);
	assert.deepEqual(waiting.approval, APPROVAL);
	assert.equal(waiting.progress, null);

	const connecting = reduce(started, approval, progress('connecting'));
	assert.equal(connecting.approval, null, 'approval is no longer pending');
	assert.equal(connecting.progress, 'connecting');

	// A network blip while the code is showing keeps the code, and recovery
	// removes only the notice.
	const degraded = reduce(started, approval, progress('connection-degraded'));
	assert.deepEqual(degraded.approval, APPROVAL);
	assert.equal(degraded.progress, 'connection-degraded');
	const recovered = pairingAttemptReducer(
		degraded,
		progress('connection-recovered'),
	);
	assert.deepEqual(recovered.approval, APPROVAL);
	assert.equal(recovered.progress, null);

	// The same blip while connecting returns to connecting, not to nothing.
	assert.equal(
		reduce(
			started,
			progress('connecting'),
			progress('connection-degraded'),
			progress('connection-recovered'),
		).progress,
		'connecting',
	);
	assert.equal(
		reduce(started, progress('connecting'), progress('connected')).progress,
		'connected',
	);
});

test('events from another attempt never change what the current attempt shows', () => {
	const current = reduce(
		{ type: 'started', attemptId: 'pair-2' },
		{ type: 'approval', attemptId: 'pair-2', approval: APPROVAL },
	);
	for (const stale of [
		{ type: 'approval', attemptId: 'pair-1', approval: { ...APPROVAL, matchCode: 'STALE' } },
		{ type: 'progress', attemptId: 'pair-1', state: 'connection-lost' },
		{ type: 'progress', attemptId: 'pair-1', state: 'connecting' },
		{ type: 'settled', attemptId: 'pair-1' },
	]) {
		assert.deepEqual(pairingAttemptReducer(current, stale), current);
	}
	// With no attempt active, nothing a host replays can raise a notice.
	assert.deepEqual(
		pairingAttemptReducer(IDLE_PAIRING_ATTEMPT, {
			type: 'progress',
			attemptId: 'pair-1',
			state: 'connection-lost',
		}),
		IDLE_PAIRING_ATTEMPT,
	);
});

test('a settled attempt clears its display, except the notice that a saved server can be retried', () => {
	const started = { type: 'started', attemptId: 'pair-1' };
	const settled = { type: 'settled', attemptId: 'pair-1' };
	assert.deepEqual(
		reduce(
			started,
			{ type: 'approval', attemptId: 'pair-1', approval: APPROVAL },
			{ type: 'progress', attemptId: 'pair-1', state: 'connection-degraded' },
			settled,
		),
		IDLE_PAIRING_ATTEMPT,
		'a failure before enrollment leaves neither a code nor a network notice',
	);
	const lost = reduce(
		started,
		{ type: 'progress', attemptId: 'pair-1', state: 'connecting' },
		{ type: 'progress', attemptId: 'pair-1', state: 'connection-lost' },
		settled,
	);
	assert.equal(lost.progress, 'connection-lost');
	// A late approval or recovery cannot replace the loss.
	assert.deepEqual(
		pairingAttemptReducer(lost, {
			type: 'approval',
			attemptId: 'pair-1',
			approval: APPROVAL,
		}),
		lost,
	);
	assert.deepEqual(
		pairingAttemptReducer(lost, {
			type: 'progress',
			attemptId: 'pair-1',
			state: 'connected',
		}),
		lost,
	);
	assert.deepEqual(
		pairingAttemptReducer(lost, { type: 'dismissed' }),
		IDLE_PAIRING_ATTEMPT,
	);
});

function renderStatus(props) {
	return renderToStaticMarkup(
		React.createElement(PairingAttemptStatus, {
			approval: null,
			busy: false,
			progress: null,
			...props,
		}),
	);
}

test('the pairing status shows one accurate step at a time', () => {
	assert.equal(renderStatus({}), '');
	assert.match(renderStatus({ busy: true }), /Contacting the server/u);

	const waiting = renderStatus({ busy: true, approval: APPROVAL });
	assert.match(waiting, /K7Q2M/u);
	assert.match(waiting, /Confirm this code on the exposing computer/u);
	assert.doesNotMatch(waiting, /Contacting|Approved|lost/u);

	const connecting = renderStatus({ busy: true, progress: 'connecting' });
	assert.match(connecting, /Approved\. Connecting to the server/u);
	assert.doesNotMatch(connecting, /Confirm this code|Contacting/u);

	const degraded = renderStatus({
		busy: true,
		approval: APPROVAL,
		progress: 'connection-degraded',
	});
	assert.match(degraded, /K7Q2M/u);
	assert.match(degraded, /UDP reachability/u);

	const lost = renderStatus({ progress: 'connection-lost' });
	assert.match(lost, /role="alert"/u);
	assert.equal(lost.includes(PAIRING_CONNECTION_LOST_COPY), true);
	assert.match(PAIRING_CONNECTION_LOST_COPY, /Your server is saved/u);

	assert.equal(renderStatus({ progress: 'connected' }), '');
});

test('connection errors reach the user without Electron or error-class wrappers', () => {
	const wrapped = (message) =>
		new Error(
			`Error invoking remote method 'server-ui-host:request-action': ${message}`,
		);
	assert.equal(
		friendlyPairingActionError(
			wrapped(
				'TypeError: Desktop pairing URL must be a Terminay pairing link or a loopback embedded-server link.',
			),
		),
		'Desktop pairing URL must be a Terminay pairing link or a loopback embedded-server link.',
	);
	assert.equal(
		friendlyPairingActionError(wrapped('Error: Desktop pairing was cancelled.')),
		'Desktop pairing was cancelled.',
	);
	assert.equal(
		friendlyPairingActionError(new Error('device profile is missing')),
		'device profile is missing',
	);
	assert.equal(friendlyPairingActionError(new Error('')), 'The connection action failed.');
	for (const stale of [
		wrapped('Error: pairing room is unavailable'),
		new Error('no-registered-host'),
		new Error('This link expired before it was approved'),
	]) {
		assert.match(
			friendlyPairingActionError(stale),
			/already been used or has expired\. Generate a new link/u,
		);
	}
	for (const unreachable of [
		wrapped('TypeError: ICE timeout'),
		wrapped('Error: The server did not answer in time.'),
		wrapped('Error: The connection to the server was lost before it answered.'),
		new Error('Desktop hosted pairing timed out before the connection opened.'),
	]) {
		assert.match(
			friendlyPairingActionError(unreachable),
			/UDP media route are reachable/u,
		);
	}
	// "device" contains "ice"; only the standalone word is a network failure.
	assert.equal(
		friendlyPairingActionError(new Error('device enrollment failed')),
		'device enrollment failed',
	);
});

test('only a required lane closing after it opened ends an established connection', () => {
	assert.equal(requiredLaneClosed('api', 'closed', true), false);
	assert.equal(requiredLaneClosed('asset', 'closed', true), false);
	assert.equal(requiredLaneClosed('control', 'closed', true), true);
	assert.equal(requiredLaneClosed('terminal', 'closing', true), true);
	assert.equal(requiredLaneClosed('control', 'closed', false), false);
});
