import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { friendlyPairingActionError } from '../src/shared/pairingActionError.ts';

const source = await readFile(
	new URL('../src/shared/SharedConnectionsRouteBody.tsx', import.meta.url),
	'utf8',
);
const errorSource = await readFile(
	new URL('../src/shared/pairingActionError.ts', import.meta.url),
	'utf8',
);
const webMain = await readFile(new URL('../src/web/main.tsx', import.meta.url), 'utf8');

test('pairing UI prevents overlapping attempts and maps IPC/network failures to useful copy', () => {
	assert.match(errorSource, /replace\(\/\^Error invoking remote method/u);
	assert.match(errorSource, /already been used or has expired/u);
	assert.match(errorSource, /UDP media route/u);
	assert.match(source, /WebRTC network path is disconnected/u);
	assert.match(source, /disabled=\{busy === 'pair'\}/u);
	assert.match(source, /busy === 'pair' \? 'Pairing…' : 'Continue pairing'/u);
	assert.doesNotMatch(source, /Waiting for approval on the exposing computer/u);
	assert.match(source, /nextPairingAttemptId/u);
	assert.match(webMain, /activeDesktopPairingAttemptId\.current !== approval\.attemptId/u);
	assert.match(webMain, /activeDesktopPairingAttemptId\.current !== progress\.attemptId/u);
	assert.match(source, /pairingProgress === 'connection-lost' && !showPair/u);
});

test('pairing error copy distinguishes device errors from ICE and recognizes stale-room failures', () => {
	assert.equal(
		friendlyPairingActionError(new Error('device profile is missing')),
		'device profile is missing',
	);
	assert.equal(
		friendlyPairingActionError(new Error('device enrollment failed')),
		'device enrollment failed',
	);
	assert.match(
		friendlyPairingActionError(new Error('pairing room is unavailable')),
		/already been used or has expired/u,
	);
	assert.match(
		friendlyPairingActionError(new Error('no-registered-host')),
		/already been used or has expired/u,
	);
	assert.match(
		friendlyPairingActionError(
			new Error('This link expired before it was approved'),
		),
		/already been used or has expired/u,
	);
	assert.match(
		friendlyPairingActionError(
			new Error(
				"Error invoking remote method 'server-ui-host:request-action': TypeError: ICE timeout",
			),
		),
		/UDP media route/u,
	);
});
