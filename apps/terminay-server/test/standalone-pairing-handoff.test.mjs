import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
	createServerRemoteExposure,
} from '../dist/index.js';

test('standalone pairing handoff uses the remote client bootstrap contract', () => {
	const exposure = createServerRemoteExposure({
		serverId: 'docker-server',
		sessionOrigin: 'https://docker.example.test',
		cleanupIntervalMs: 0,
	});

	const handoff = exposure.start(Date.now() + 60_000);
	const url = new URL(handoff.pairingUrl);
	const bootstrap = new URLSearchParams(url.hash.slice(1));

	assert.equal(url.protocol, 'https:');
	assert.equal(url.search, '');
	assert.equal(bootstrap.get('pairingSessionId'), handoff.roomId);
	assert.equal(bootstrap.get('pairingSessionId'), handoff.pairingSessionId);
	assert.equal(bootstrap.get('pairingToken'), handoff.secret);
	assert.equal(bootstrap.get('pairingToken'), handoff.pairingToken);
	assert.equal(bootstrap.get('pairingExpiresAt'), handoff.pairingExpiresAt);
	assert.equal(new Date(handoff.pairingExpiresAt).getTime(), handoff.expiresAt);
	assert.notEqual(url.hash, `#${handoff.secret}`);

	return exposure.shutdown();
});

test('hosted compact pairing URL keeps the QR secret in the fragment', async () => {
	const { deriveHostedPairingSecrets } = await import('../dist/remote/hostedPairingSecrets.js');
	const exposure = createServerRemoteExposure({
		serverId: 'hosted-server',
		sessionOrigin: 'https://abc12345.terminay.com',
		pairingUrlFormat: 'hosted-compact',
		cleanupIntervalMs: 0,
	});

	const handoff = exposure.start(Date.now() + 60_000);
	const url = new URL(handoff.pairingUrl);
	const qrSecret = url.hash.slice(1);
	const derived = deriveHostedPairingSecrets(qrSecret);

	assert.equal(url.protocol, 'https:');
	assert.equal(url.pathname, '/v1/');
	assert.equal(url.search, '');
	assert.equal(handoff.pairingSessionId, derived.pairingRoomId);
	assert.equal(handoff.pairingToken, derived.pairingToken);
	assert.notEqual(qrSecret, handoff.pairingToken);
	assert.equal(exposure.pairing.metadata(derived.pairingRoomId)?.state, 'active');

	return exposure.shutdown();
});

test('hosted session ids come from the stable session hostname', async () => {
	const { hostedSessionId } = await import('../dist/remote/hostedPairingSecrets.js');
	assert.equal(hostedSessionId('https://abc12345.terminay.com'), 'abc12345');
	assert.equal(hostedSessionId('https://abc12345.terminay.com:8443'), 'abc12345');
	assert.throws(() => hostedSessionId('https://app.terminay.com'), /invalid/);
});

test('compiled standalone pairing CLI emits a fragment-only handoff and does not start server state', async () => {
	const dataRoot = await mkdtemp(join(tmpdir(), 'terminay-pairing-cli-'));
	const remoteOrigin = 'https://pairing.example.test';
	const child = spawn(process.execPath, [
		'dist/cli.js',
		'--pairing',
		'--server-id', 'compiled-pairing-server',
		'--remote-origin', remoteOrigin,
		'--data-root', join(dataRoot, 'state'),
	], {
		cwd: fileURLToPath(new URL('../', import.meta.url)),
		env: { ...process.env, TERMINAY_REMOTE_PAIRING_PIN: '736941', TERMINAY_SERVER_VERSION: '0.0.0' },
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	let stdout = '';
	let stderr = '';
	child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
	child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
	try {
		const [code] = await once(child, 'exit');
		assert.equal(code, 0, stderr);
		const handoff = JSON.parse(stdout);
		assert.equal(handoff.serverId, 'compiled-pairing-server');
		assert.equal(handoff.endpoint, 'loopback');
		assert.equal(handoff.requiresApproval, true);
		assert.equal(typeof handoff.pairingUrl, 'string');
		const url = new URL(handoff.pairingUrl);
		assert.equal(url.origin, remoteOrigin);
		assert.equal(url.search, '');
		const bootstrap = new URLSearchParams(url.hash.slice(1));
		assert.equal(bootstrap.get('pairingSessionId'), handoff.pairingSessionId);
		assert.equal(typeof bootstrap.get('pairingToken'), 'string');
		assert.equal(bootstrap.get('pairingToken')?.length > 0, true);
		assert.equal(stdout.includes(bootstrap.get('pairingToken')), true);
		await assert.rejects(stat(join(dataRoot, 'state')), { code: 'ENOENT' });
	} finally {
		await rm(dataRoot, { recursive: true, force: true });
	}
});

test('compiled standalone pairing CLI requires a configured PIN without revealing it', async () => {
	const { TERMINAY_REMOTE_PAIRING_PIN: _omitted, ...environment } = process.env;
	const child = spawn(process.execPath, ['dist/cli.js', '--pairing'], {
		cwd: fileURLToPath(new URL('../', import.meta.url)),
		env: { ...environment, TERMINAY_SERVER_VERSION: '0.0.0' },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let stdout = '';
	let stderr = '';
	child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
	child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
	const [code] = await once(child, 'exit');
	assert.equal(code, 1);
	assert.equal(stdout, '');
	assert.match(stderr, /TERMINAY_REMOTE_PAIRING_PIN must be configured/u);
	assert.doesNotMatch(stderr, /736941/u);
});

test('standalone CLI emits a pairing handoff and remains foreground until terminated', async () => {
	const child = spawn(process.execPath, [
		'dist/cli.js',
		'--server-id', 'foreground-server',
		'--data-root', '/tmp/terminay-foreground-pairing-test',
		'--health-host', '127.0.0.1',
		'--health-port', '0',
		'--vault-unlock-fd', '3',
	], {
		cwd: fileURLToPath(new URL('../', import.meta.url)),
		env: { ...process.env, TERMINAY_REMOTE_PAIRING_PIN: '736941', TERMINAY_SERVER_VERSION: 'test' },
		stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
	});
	child.stdio[3].end('test-vault-passphrase\n');

	let output = '';
	const line = new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error('CLI readiness timed out')), 5_000);
		child.stdout.on('data', (chunk) => {
			output += chunk.toString();
			const newline = output.indexOf('\n');
			if (newline < 0) return;
			clearTimeout(timeout);
			resolve(JSON.parse(output.slice(0, newline)));
		});
		child.once('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});
	});

	try {
		const ready = await line;
		assert.equal(ready.ready, true);
		assert.equal(ready.pairing.pairingSessionId.startsWith('pair-'), true);
		assert.equal(typeof ready.pairing.pairingExpiresAt, 'string');
		const pairingUrl = new URL(ready.pairing.pairingUrl);
		const bootstrap = new URLSearchParams(pairingUrl.hash.slice(1));
		assert.equal(bootstrap.get('pairingSessionId'), ready.pairing.pairingSessionId);
		assert.equal(typeof bootstrap.get('pairingToken'), 'string');
		assert.equal(child.exitCode, null);
	} finally {
		if (child.exitCode === null) {
			child.kill('SIGTERM');
			await once(child, 'exit').catch(() => undefined);
		}
	}
});
