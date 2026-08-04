import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import {
	signSecureWeriftArchive,
	verifySecureWeriftArchiveSignature,
} from './build-secure-werift-candidate.mjs';

test('secure Werift archive supports detached release signing without mutating deterministic payloads', () => {
	const archive = {
		bytes: new TextEncoder().encode('deterministic-secure-werift-archive'),
		filename: 'terminay-werift-runtime-proof-0.24.1-candidate.1.tgz',
	};
	const release = generateKeyPairSync('ed25519');
	const attacker = generateKeyPairSync('ed25519');
	const metadata = signSecureWeriftArchive(
		archive,
		release.privateKey,
		'release-2026-07',
	);

	assert.equal(metadata.algorithm, 'Ed25519');
	assert.equal(metadata.artifact, archive.filename);
	assert.match(metadata.sha256, /^[a-f0-9]{64}$/u);
	assert.equal(
		verifySecureWeriftArchiveSignature(archive, metadata, release.publicKey),
		true,
	);
	assert.throws(
		() =>
			verifySecureWeriftArchiveSignature(
				{ ...archive, bytes: new TextEncoder().encode('tampered') },
				metadata,
				release.publicKey,
			),
		/sha-256/iu,
	);
	assert.throws(
		() =>
			verifySecureWeriftArchiveSignature(archive, metadata, attacker.publicKey),
		/signature verification failed/u,
	);
});
