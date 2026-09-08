import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createDirectSignalingRelay } from '../dist/remote/directSignalingRelay.js';
import {
	DIRECT_TLS_FILE,
	loadOrCreateDirectTlsCertificate,
} from '../dist/remote/directTlsCertificate.js';

const DIRECT_ORIGIN = 'https://box.example.test:8443';

async function withDataRoot(body) {
	const root = await mkdtemp(join(tmpdir(), 'terminay-direct-tls-'));
	try {
		return await body(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test('the direct certificate is minted once, owner-only, and reused across restarts', () =>
	withDataRoot(async (root) => {
		const first = await loadOrCreateDirectTlsCertificate(root, DIRECT_ORIGIN);
		assert.match(first.cert, /^-----BEGIN CERTIFICATE-----/u);
		assert.match(first.key, /^-----BEGIN (?:RSA )?PRIVATE KEY-----/u);
		assert.match(first.fingerprint, /^[a-f0-9]{64}$/u);
		assert.equal(first.host, 'box.example.test');

		const file = join(root, DIRECT_TLS_FILE);
		// The file holds a durable private key, so it is owner-only inside the
		// data root even though the certificate itself authenticates nothing.
		assert.equal((await stat(file)).mode & 0o777, 0o600);
		const persisted = JSON.parse(await readFile(file, 'utf8'));
		assert.equal(persisted.schemaVersion, 1);

		const second = await loadOrCreateDirectTlsCertificate(root, DIRECT_ORIGIN);
		assert.equal(second.cert, first.cert);
		assert.equal(second.key, first.key);
	}));

test('a certificate for another host, an expired one, or a group-readable one is replaced', () =>
	withDataRoot(async (root) => {
		const first = await loadOrCreateDirectTlsCertificate(root, DIRECT_ORIGIN);
		const other = await loadOrCreateDirectTlsCertificate(root, 'https://other.example.test');
		assert.notEqual(other.cert, first.cert);
		assert.equal(other.host, 'other.example.test');

		const file = join(root, DIRECT_TLS_FILE);
		const persisted = JSON.parse(await readFile(file, 'utf8'));
		await writeFile(
			file,
			`${JSON.stringify({ ...persisted, notAfter: new Date(0).toISOString() })}\n`,
			{ mode: 0o600 },
		);
		const afterExpiry = await loadOrCreateDirectTlsCertificate(root, 'https://other.example.test');
		assert.notEqual(afterExpiry.cert, other.cert);

		await chmod(file, 0o644);
		const replaced = await loadOrCreateDirectTlsCertificate(root, 'https://other.example.test');
		assert.notEqual(replaced.cert, afterExpiry.cert);
		assert.equal((await stat(file)).mode & 0o777, 0o600);
	}));

test('the signaling endpoint answers over TLS with the generated certificate', () =>
	withDataRoot(async (root) => {
		const certificate = await loadOrCreateDirectTlsCertificate(root, DIRECT_ORIGIN);
		const relay = createDirectSignalingRelay({
			sessionOrigin: DIRECT_ORIGIN,
			managerOrigin: 'https://app.example.test',
		});
		const server = createServer({ cert: certificate.cert, key: certificate.key });
		server.on('upgrade', (request, socket, head) => relay.handleUpgrade(request, socket, head));
		await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
		const { port } = server.address();
		try {
			// A client reaches the endpoint over `wss` and does not verify this
			// certificate: the server host key signs the transport transcript, and
			// that signature is the only authentication of the endpoint.
			const socket = new WebSocket(`wss://127.0.0.1:${port}/signal`, {
				headers: { host: 'box.example.test:8443' },
				rejectUnauthorized: false,
			});
			await once(socket, 'open');
			const answered = new Promise((resolveFrame) =>
				socket.once('message', (raw) => resolveFrame(JSON.parse(String(raw)))),
			);
			socket.send(JSON.stringify({ type: 'host-ready', roomId: 'pair-room' }));
			assert.deepEqual(await answered, { type: 'host-registered', roomId: 'pair-room' });
			socket.terminate();
		} finally {
			await relay.close();
			await new Promise((resolveClose) => server.close(resolveClose));
		}
	}));
