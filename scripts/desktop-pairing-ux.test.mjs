import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
	new URL('../src/shared/SharedConnectionsRouteBody.tsx', import.meta.url),
	'utf8',
);

test('pairing UI prevents overlapping attempts and maps IPC/network failures to useful copy', () => {
	assert.match(source, /replace\(\/\^Error invoking remote method/u);
	assert.match(source, /already been used or has expired/u);
	assert.match(source, /UDP media route/u);
	assert.match(source, /WebRTC network path is disconnected/u);
	assert.match(source, /disabled=\{busy === 'pair'\}/u);
	assert.match(source, /busy === 'pair' \? 'Pairing…' : 'Continue pairing'/u);
	assert.doesNotMatch(source, /Waiting for approval on the exposing computer/u);
});
