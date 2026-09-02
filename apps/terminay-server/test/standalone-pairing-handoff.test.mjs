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
		hostName: 'Studio-Mac.local',
		cleanupIntervalMs: 0,
	});

	const handoff = exposure.start(Date.now() + 60_000);
	const url = new URL(handoff.pairingUrl);
	const qrSecret = url.hash.slice(1);
	const derived = deriveHostedPairingSecrets(qrSecret);

	assert.equal(url.protocol, 'https:');
	assert.equal(url.hostname, 'app.terminay.com');
	assert.equal(url.pathname, '/');
	assert.equal(url.searchParams.get('s'), 'abc12345');
	assert.equal(url.searchParams.get('hostName'), 'Studio-Mac');
	assert.deepEqual([...url.searchParams.keys()].sort(), ['hostName', 'pairingExpiresAt', 's']);
	assert.equal(handoff.pairingSessionId, derived.pairingRoomId);
	assert.equal(handoff.pairingToken, derived.pairingToken);
	assert.notEqual(qrSecret, handoff.pairingToken);
	assert.equal(exposure.pairing.metadata(derived.pairingRoomId)?.state, 'active');

	return exposure.shutdown();
});

test('hosted pairing rotation keeps exposure and reconnect availability longer than the QR', async () => {
	const { deriveHostedPairingSecrets } = await import('../dist/remote/hostedPairingSecrets.js');
	const now = Date.now();
	const exposure = createServerRemoteExposure({
		serverId: 'hosted-server',
		sessionOrigin: 'https://abc12345.terminay.com',
		pairingUrlFormat: 'hosted-compact',
		cleanupIntervalMs: 0,
	});

	const first = exposure.start(now + 60_000);
	const rotated = exposure.rotateHostedPairing(now + 120_000);
	assert.notEqual(rotated.pairingUrl, first.pairingUrl);
	assert.notEqual(rotated.pairingSessionId, first.pairingSessionId);
	assert.equal(new URL(rotated.pairingUrl).hostname, 'app.terminay.com');
	assert.equal(new URL(rotated.pairingUrl).searchParams.get('s'), 'abc12345');
	assert.equal(
		exposure.pairing.metadata(deriveHostedPairingSecrets(new URL(first.pairingUrl).hash.slice(1)).pairingRoomId),
		undefined,
	);
	assert.equal(
		exposure.pairing.metadata(deriveHostedPairingSecrets(new URL(rotated.pairingUrl).hash.slice(1)).pairingRoomId)?.state,
		'active',
	);
	assert.equal(exposure.status.exposure.state, 'exposed');
	assert.ok((exposure.status.exposure.expiresAt ?? 0) >= now + 120_000);

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
		env: { ...process.env, TERMINAY_SERVER_VERSION: '0.0.0' },
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

test('compiled standalone CLI refuses a leftover pairing PIN variable without revealing it', async () => {
	// The PIN is gone: pairing is approved on the host with a match code. A
	// stale operator environment must fail visibly rather than be ignored.
	const child = spawn(process.execPath, ['dist/cli.js', '--pairing'], {
		cwd: fileURLToPath(new URL('../', import.meta.url)),
		env: { ...process.env, TERMINAY_REMOTE_PAIRING_PIN: '736941', TERMINAY_SERVER_VERSION: '0.0.0' },
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let stdout = '';
	let stderr = '';
	child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
	child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
	const [code] = await once(child, 'exit');
	assert.equal(code, 1);
	assert.equal(stdout, '');
	assert.match(stderr, /TERMINAY_REMOTE_PAIRING_PIN is no longer used/u);
	assert.doesNotMatch(stderr, /736941/u);
});

test('standalone CLI emits a pairing handoff and remains foreground until terminated', async () => {
	// A data root is leased exclusively and is deliberately never auto-stolen,
	// so a shared fixed path leaves a lock behind whenever a run is killed and
	// every later run then fails to start. Isolate and clean up this one.
	const dataRoot = await mkdtemp(join(tmpdir(), 'terminay-foreground-pairing-'));
	const child = spawn(process.execPath, [
		'dist/cli.js',
		'--server-id', 'foreground-server',
		'--data-root', dataRoot,
		'--health-host', '127.0.0.1',
		'--health-port', '0',
		'--vault-unlock-fd', '3',
	], {
		cwd: fileURLToPath(new URL('../', import.meta.url)),
		env: { ...process.env, TERMINAY_SERVER_VERSION: 'test' },
		stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
	});
	child.stdio[3].end('test-vault-passphrase\n');

	let output = '';
	// Startup failures are reported on stderr. Carry them into the timeout so a
	// failure names its cause instead of only saying readiness timed out.
	let errorOutput = '';
	child.stderr.on('data', (chunk) => {
		errorOutput += chunk.toString();
	});
	const line = new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() =>
				reject(
					new Error(
						`CLI readiness timed out${errorOutput.trim() === '' ? '' : `: ${errorOutput.trim()}`}`,
					),
				),
			10_000,
		);
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
		await rm(dataRoot, { force: true, recursive: true }).catch(() => undefined);
	}
});
