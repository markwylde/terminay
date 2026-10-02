// Desktop pairs with a real standalone `terminay-server` over its loopback
// HTTP listener: the production Desktop enrollment and reconnect code runs
// against the compiled server CLI, with no stubbed response on either side.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { TerminayClient } from '@terminay/client-core';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'terminay-loopback-pairing-'));
const output = join(directory, 'desktopLoopback.mjs');
await build({
	absWorkingDir: repositoryRoot,
	alias: {
		'@terminay/protocol': join(repositoryRoot, 'packages/protocol/src/index.ts'),
	},
	banner: {
		js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
	},
	bundle: true,
	format: 'esm',
	logLevel: 'silent',
	outfile: output,
	platform: 'node',
	stdin: {
		contents: [
			"export { establishDesktopDevicePairing } from './electron/remote/desktopPairing';",
			"export { createDesktopReconnectTransport } from './electron/remote/desktopReconnect';",
			"export { DesktopDeviceCredentialStore, createEphemeralTestProtectedValueCodec } from './electron/remote/deviceCredentialStore';",
		].join('\n'),
		loader: 'ts',
		resolveDir: repositoryRoot,
	},
	target: 'node20',
});
const {
	establishDesktopDevicePairing,
	createDesktopReconnectTransport,
	DesktopDeviceCredentialStore,
	createEphemeralTestProtectedValueCodec,
} = await import(output);
test.after(async () => {
	await rm(directory, { force: true, recursive: true });
});

async function startStandaloneServer(root) {
	const child = spawn(
		process.execPath,
		[
			join(repositoryRoot, 'apps/terminay-server/dist/cli.js'),
			'--server-id',
			'build-box',
			'--data-root',
			join(root, 'data'),
			'--project-root',
			root,
			'--http-host',
			'127.0.0.1',
			'--http-port',
			'0',
		],
		{
			env: { ...process.env, TERMINAY_SERVER_VERSION: '0.0.0' },
			stdio: ['ignore', 'pipe', 'pipe'],
		},
	);
	let stdout = '';
	let stderr = '';
	child.stderr.on('data', (chunk) => {
		stderr += chunk.toString();
	});
	const ready = await new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error(`server readiness timed out: ${stderr.trim()}`)),
			30_000,
		);
		const settle = (action, value) => {
			clearTimeout(timeout);
			action(value);
		};
		child.stdout.on('data', (chunk) => {
			stdout += chunk.toString();
			for (;;) {
				const newline = stdout.indexOf('\n');
				if (newline < 0) return;
				const line = stdout.slice(0, newline);
				stdout = stdout.slice(newline + 1);
				try {
					const parsed = JSON.parse(line);
					if (parsed.ready === true) settle(resolve, parsed);
				} catch {
					// Non-JSON startup output is not the readiness line.
				}
			}
		});
		child.once('error', (error) => settle(reject, error));
		child.once('exit', (code) =>
			settle(reject, new Error(`server exited ${code}: ${stderr.trim()}`)),
		);
	});
	return {
		ready,
		async stop() {
			if (child.exitCode !== null) return;
			child.kill('SIGTERM');
			await once(child, 'exit').catch(() => undefined);
		},
	};
}

async function post(origin, pathname, body) {
	const response = await fetch(new URL(pathname, origin), {
		body: JSON.stringify(body),
		headers: { 'content-type': 'application/json' },
		method: 'POST',
	});
	return response.status;
}

test('Desktop enrolls, authenticates, and connects to a standalone server over loopback HTTP', async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-loopback-server-'));
	const server = await startStandaloneServer(root);
	let client;
	try {
		const pairingUrl = server.ready.pairing.pairingUrl;
		const advertised = new URL(pairingUrl);
		assert.equal(advertised.protocol, 'http:');
		assert.equal(advertised.hostname, '127.0.0.1');
		const fragment = new URLSearchParams(advertised.hash.slice(1));

		const store = new DesktopDeviceCredentialStore({
			directory: join(root, 'desktop-credentials'),
			codec: createEphemeralTestProtectedValueCodec(),
		});
		const enrolled = await establishDesktopDevicePairing({
			deviceName: 'Terminay Desktop',
			pairingUrl,
			store,
		});
		assert.equal(enrolled.origin, advertised.origin);
		assert.equal(enrolled.deviceName, 'Terminay Desktop');
		const saved = await store.loadDevice(advertised.origin);
		assert.equal(saved?.deviceId, enrolled.deviceId);

		// The one-time pairing material is spent by enrollment.
		const replayKey = store.createDeviceKey(advertised.origin);
		assert.equal(
			await post(advertised.origin, '/api/devices/enroll', {
				deviceName: 'Replay',
				pairingExpiresAt: fragment.get('pairingExpiresAt'),
				pairingSessionId: fragment.get('pairingSessionId'),
				pairingToken: fragment.get('pairingToken'),
				publicKeyPem: replayKey.publicKeyPem,
			}),
			403,
		);

		// Reconnect proves possession of the device key; the resulting one-use
		// ticket opens the application protocol stream.
		const connected = await createDesktopReconnectTransport({
			origin: advertised.origin,
			store,
		});
		assert.equal(connected.deviceId, enrolled.deviceId);
		assert.equal(connected.signalingBootstrap, undefined);
		client = new TerminayClient({
			transport: connected.transport,
			clientId: 'desktop-loopback-pairing-test',
			clientVersion: '0.0.0',
			capabilities: [],
		});
		const hello = await client.connect();
		assert.equal(hello.serverId, 'build-box');
		assert.equal(client.state, 'connected');

		// A device that never enrolled gets no challenge.
		assert.equal(
			await post(advertised.origin, '/api/devices/challenge', {
				deviceId: 'device-unknown',
			}),
			403,
		);
	} finally {
		await client?.close().catch(() => undefined);
		await server.stop();
		await rm(root, { force: true, recursive: true });
	}
});
