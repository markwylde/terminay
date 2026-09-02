import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { AUTHENTICATED_WEBRTC_TRANSPORT_VERSION } from '../packages/protocol/dist/index.js';

const directory = await mkdtemp(join(tmpdir(), 'terminay-webrtc-release-'));
const output = join(directory, 'gate.mjs');
await build({
	bundle: true,
	entryPoints: ['electron/remote/desktopAuthenticatedWebRtc.ts'],
	format: 'esm',
	logLevel: 'silent',
	outfile: output,
	platform: 'node',
	target: 'node20',
});
const { assertAuthenticatedRemoteAccessContract } = await import(pathToFileURL(output).href);
test.after(async () => rm(directory, { force: true, recursive: true }));

test('a build cannot advertise remote access without the authenticated transport contract version', () => {
	assert.equal(AUTHENTICATED_WEBRTC_TRANSPORT_VERSION, 1);
	assertAuthenticatedRemoteAccessContract(1, 1);
	assert.throws(() => assertAuthenticatedRemoteAccessContract(2, 1), /cannot be advertised/);
	assert.throws(() => assertAuthenticatedRemoteAccessContract(1, 2), /cannot be advertised/);
	assert.throws(() => assertAuthenticatedRemoteAccessContract(undefined, 1), /cannot be advertised/);
});

test('client and server both require authenticated transport contract version 1', async () => {
	const [sessionHost, pairingHost, exposure] = await Promise.all([
		readFile('src/web/sessionTransportHost.ts', 'utf8'),
		readFile('apps/terminay-server/src/remote/hostedPairingHost.ts', 'utf8'),
		readFile('electron/remote/serverOwnedExposure.ts', 'utf8'),
	]);
	assert.match(sessionHost, /authenticatedTransportVersion !== 1/);
	assert.match(pairingHost, /AUTHENTICATED_WEBRTC_TRANSPORT_VERSION/);
	assert.match(exposure, /assertAuthenticatedRemoteAccessContract/);
});

test('Electron acceptance for remote access is the container E2E command', async () => {
	const [packageJson, evidence] = await Promise.all([
		readFile('package.json', 'utf8'),
		readFile('openspec/adr/evidence/hostile-relay-authenticated-transport.md', 'utf8'),
	]);
	const parsed = JSON.parse(packageJson);
	assert.match(parsed.scripts['test:e2e'], /run-e2e-container/);
	assert.equal(parsed.scripts['test:e2e:host'].includes('playwright test'), true);
	assert.match(evidence, /npm run test:e2e/);
	assert.match(evidence, /test:e2e:host/);
	assert.match(evidence, /hostile/);
	assert.doesNotMatch(evidence, /npm run test:e2e:host` is a release gate/u);
});
