import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	createDeviceHostReadyMessage,
	createHostedHostKey,
	DEVICE_HOST_PROOF_LABEL,
	deviceHostProofPayload,
	loadOrCreateHostedHostKey,
	parseHostedHostKey,
	serializeHostedHostKey,
} from '../dist/remote/hostedHostKey.js';

test('a hosted host key signs device-host-ready for the same public key', () => {
	const hostKey = createHostedHostKey();
	const expiresAt = new Date(Date.now() + 60_000).toISOString();
	const message = createDeviceHostReadyMessage({
		expiresAt,
		hostKey,
		sessionId: 'session123',
	});

	assert.equal(message.type, 'device-host-ready');
	assert.equal(message.hostKeyAlgorithm, 'ed25519');
	assert.equal(message.hostPublicKey, hostKey.publicKey);
	assert.equal(message.sessionId, 'session123');
	assert.equal(message.expiresAt, expiresAt);
	assert.equal(
		verify(
			null,
			deviceHostProofPayload({
				expiresAt,
				hostPublicKey: hostKey.publicKey,
				sessionId: 'session123',
			}),
			createPublicKey(hostKey.privateKeyPem),
			Buffer.from(message.hostProof, 'base64url'),
		),
		true,
	);
	assert.match(DEVICE_HOST_PROOF_LABEL, /^terminay remote v1 device host$/u);
});

test('a different host key cannot produce a valid proof for the original public key', () => {
	const original = createHostedHostKey();
	const attacker = createHostedHostKey();
	const expiresAt = new Date(Date.now() + 60_000).toISOString();
	const forged = createDeviceHostReadyMessage({
		expiresAt,
		hostKey: attacker,
		sessionId: 'session123',
	});

	assert.equal(
		verify(
			null,
			deviceHostProofPayload({
				expiresAt,
				hostPublicKey: original.publicKey,
				sessionId: 'session123',
			}),
			createPublicKey(original.privateKeyPem),
			Buffer.from(forged.hostProof, 'base64url'),
		),
		false,
	);
	assert.notEqual(attacker.publicKey, original.publicKey);
});

test('hosted host keys persist across load and reject a corrupt file', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-host-key-'));
	const file = join(directory, 'remote-host-key.v1.json');
	try {
		const created = loadOrCreateHostedHostKey(file);
		const loaded = loadOrCreateHostedHostKey(file);
		assert.equal(loaded.publicKey, created.publicKey);
		assert.equal(loaded.privateKeyPem, created.privateKeyPem);
		assert.match(await readFile(file, 'utf8'), /BEGIN PRIVATE KEY/);

		const roundTrip = parseHostedHostKey(JSON.parse(serializeHostedHostKey(created)));
		assert.equal(roundTrip.publicKey, created.publicKey);

		await writeFile(file, '{"schemaVersion":1,"algorithm":"ed25519"}\n');
		assert.throws(() => loadOrCreateHostedHostKey(file), /Hosted host key is invalid/);

		const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
		assert.throws(
			() =>
				parseHostedHostKey({
					algorithm: 'ed25519',
					privateKeyPem: rsa.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
					schemaVersion: 1,
				}),
			/Hosted host key is invalid/,
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
