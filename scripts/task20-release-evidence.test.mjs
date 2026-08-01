import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import {
	RELEASE_EVIDENCE_CLASSES,
	ReleaseEvidenceError,
	requireExternalReleaseEvidence,
	validateReleaseEvidence,
} from './task20-release-evidence.mjs';
import { signKeyDistribution, verifyKeyDistribution } from './task20-signature-key-distribution.mjs';

const SHA = 'a'.repeat(64);

function localRecord(overrides = {}) {
	return {
		schemaVersion: 1,
		evidenceId: 'task20-local-artifact-contract',
		artifactId: 'terminay-server-1.2.3',
		version: '1.2.3',
		artifactSha256: SHA,
		manifestSha256: SHA,
		classification: RELEASE_EVIDENCE_CLASSES.LOCAL_CONTRACT,
		commands: ['node --test scripts/task20-release-artifact.test.mjs'],
		...overrides,
	};
}

function trustedKeyDistribution({ keyId = 'terminay-release-2026', revoked = false, notBefore = '2026-07-01T00:00:00.000Z', notAfter = '2026-08-01T00:00:00.000Z' } = {}) {
	const root = generateKeyPairSync('ed25519');
	const release = generateKeyPairSync('ed25519');
	const distribution = signKeyDistribution({
		version: 1,
		generatedAt: '2026-07-28T00:00:00.000Z',
		keys: [{
			keyId,
			algorithm: 'ed25519',
			publicKey: release.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
			notBefore,
			notAfter,
			revoked,
		}],
	}, root.privateKey);
	return verifyKeyDistribution(distribution, root.publicKey, { now: new Date('2026-07-28T12:00:00.000Z') });
}

function signedPublicationEvidence(bytes, manifestBytes = Buffer.from('release manifest')) {
	const root = generateKeyPairSync('ed25519');
	const release = generateKeyPairSync('ed25519');
	const distribution = signKeyDistribution({
		version: 1,
		generatedAt: '2026-07-28T00:00:00.000Z',
		keys: [{
			keyId: 'terminay-release-2026',
			algorithm: 'ed25519',
			publicKey: release.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
			notBefore: '2026-07-01T00:00:00.000Z',
			notAfter: '2026-08-01T00:00:00.000Z',
			revoked: false,
		}],
	}, root.privateKey);
	return {
		artifactBytes: bytes,
		manifestBytes,
		detachedSignature: sign(null, bytes, release.privateKey).toString('base64'),
		trustedDistribution: verifyKeyDistribution(distribution, root.publicKey, { now: new Date('2026-07-28T12:00:00.000Z') }),
	};
}

test('local contract evidence records exact bytes but cannot satisfy a publication gate', () => {
	const verified = validateReleaseEvidence(localRecord());
	assert.equal(verified.classification, RELEASE_EVIDENCE_CLASSES.LOCAL_CONTRACT);
	assert.equal(Object.isFrozen(verified), true);
	assert.throws(
		() => requireExternalReleaseEvidence(localRecord()),
		(error) => error instanceof ReleaseEvidenceError && error.code === 'external-evidence-required',
	);
});

test('local evidence fails closed when it attempts to claim a runner or publication', () => {
	assert.throws(
		() => validateReleaseEvidence(localRecord({ execution: { runner: 'linux-x64', completedAt: '2026-07-28T12:00:00Z' } })),
		(error) => error instanceof ReleaseEvidenceError && error.code === 'local-claims-publication',
	);
	assert.throws(
		() => validateReleaseEvidence(localRecord({ publication: { uri: `https://ghcr.io/acme/terminay@sha256:${SHA}`, publishedAt: '2026-07-28T12:00:00Z', signerKeyId: 'release-key' } })),
		(error) => error instanceof ReleaseEvidenceError && error.code === 'local-claims-publication',
	);
});

test('native runner evidence is distinct from publication evidence', () => {
	const runner = validateReleaseEvidence(localRecord({
		classification: RELEASE_EVIDENCE_CLASSES.NATIVE_RUNNER,
		execution: { runner: 'macos-12-arm64', completedAt: '2026-07-28T12:00:00Z' },
	}));
	assert.equal(runner.execution.runner, 'macos-12-arm64');
	assert.throws(
		() => requireExternalReleaseEvidence(runner),
		(error) => error instanceof ReleaseEvidenceError && error.code === 'external-evidence-required',
	);
});

test('published artifact evidence requires immutable digest URI and a signer identity', () => {
	const artifactBytes = Buffer.from('published artifact');
	const manifestBytes = Buffer.from('published manifest');
	const digest = createHash('sha256').update(artifactBytes).digest('hex');
	const manifestDigest = createHash('sha256').update(manifestBytes).digest('hex');
	const published = requireExternalReleaseEvidence(localRecord({
		classification: RELEASE_EVIDENCE_CLASSES.PUBLISHED_ARTIFACT,
		execution: { runner: 'linux-x64-release', completedAt: '2026-07-28T12:00:00Z' },
		artifactSha256: digest,
		manifestSha256: manifestDigest,
		publication: { uri: `https://ghcr.io/acme/terminay@sha256:${digest}`, publishedAt: '2026-07-28T12:05:00Z', signerKeyId: 'terminay-release-2026' },
	}), signedPublicationEvidence(artifactBytes, manifestBytes));
	assert.equal(published.publication.signerKeyId, 'terminay-release-2026');
	assert.throws(
		() => validateReleaseEvidence(localRecord({
			classification: RELEASE_EVIDENCE_CLASSES.PUBLISHED_ARTIFACT,
			execution: { runner: 'linux-x64-release', completedAt: '2026-07-28T12:00:00Z' },
			publication: { uri: 'https://ghcr.io/acme/terminay:latest', publishedAt: '2026-07-28T12:05:00Z', signerKeyId: 'terminay-release-2026' },
		}), { trustedDistribution: trustedKeyDistribution() }),
		(error) => error instanceof ReleaseEvidenceError && error.code === 'invalid-publication',
	);
});

test('external release evidence verifies exact artifact bytes and detached signature', () => {
	const artifactBytes = Buffer.from('exact release artifact');
	const manifestBytes = Buffer.from('exact release manifest');
	const digest = createHash('sha256').update(artifactBytes).digest('hex');
	const manifestDigest = createHash('sha256').update(manifestBytes).digest('hex');
	const evidence = signedPublicationEvidence(artifactBytes, manifestBytes);
	const record = localRecord({
		classification: RELEASE_EVIDENCE_CLASSES.PUBLISHED_ARTIFACT,
		artifactSha256: digest,
		manifestSha256: manifestDigest,
		execution: { runner: 'linux-x64-release', completedAt: '2026-07-28T12:00:00Z' },
		publication: { uri: `https://ghcr.io/acme/terminay@sha256:${digest}`, publishedAt: '2026-07-28T12:05:00Z', signerKeyId: 'terminay-release-2026' },
	});
	assert.equal(requireExternalReleaseEvidence(record, evidence).verification.artifactSha256, digest);
	assert.throws(
		() => requireExternalReleaseEvidence(record, { ...evidence, artifactBytes: Buffer.from('substituted artifact') }),
		(error) => error instanceof ReleaseEvidenceError && error.code === 'artifact-bytes-digest-mismatch',
	);
	assert.throws(
		() => requireExternalReleaseEvidence(record, { ...evidence, detachedSignature: 'not-a-valid-signature' }),
		(error) => error instanceof ReleaseEvidenceError && error.code === 'detached-signature-invalid',
	);
	assert.throws(
		() => requireExternalReleaseEvidence(record, { ...evidence, manifestBytes: Buffer.from('substituted manifest') }),
		(error) => error instanceof ReleaseEvidenceError && error.code === 'manifest-bytes-digest-mismatch',
	);
	assert.throws(
		() => requireExternalReleaseEvidence(record, { ...evidence, manifestBytes: undefined }),
		(error) => error instanceof ReleaseEvidenceError && error.code === 'manifest-bytes-required',
	);
});

test('published artifact evidence binds the immutable publication digest to the recorded artifact bytes', () => {
	assert.throws(
		() => requireExternalReleaseEvidence(localRecord({
			classification: RELEASE_EVIDENCE_CLASSES.PUBLISHED_ARTIFACT,
			execution: { runner: 'linux-x64-release', completedAt: '2026-07-28T12:00:00Z' },
			publication: { uri: `https://ghcr.io/acme/terminay@sha256:${'b'.repeat(64)}`, publishedAt: '2026-07-28T12:05:00Z', signerKeyId: 'terminay-release-2026' },
		}), { trustedDistribution: trustedKeyDistribution() }),
		(error) => error instanceof ReleaseEvidenceError && error.code === 'publication-digest-mismatch',
	);
});

test('publication evidence requires a root-authenticated active signing key at its claimed publication instant', () => {
	const record = localRecord({
		classification: RELEASE_EVIDENCE_CLASSES.PUBLISHED_ARTIFACT,
		execution: { runner: 'linux-x64-release', completedAt: '2026-07-28T12:00:00Z' },
		publication: { uri: `https://ghcr.io/acme/terminay@sha256:${SHA}`, publishedAt: '2026-07-28T12:05:00Z', signerKeyId: 'terminay-release-2026' },
	});
	assert.throws(
		() => requireExternalReleaseEvidence(record),
		(error) => error instanceof ReleaseEvidenceError && error.code === 'key-distribution-required',
	);
	assert.throws(
		() => requireExternalReleaseEvidence(record, { trustedDistribution: trustedKeyDistribution({ keyId: 'other-key' }) }),
		(error) => error instanceof ReleaseEvidenceError && error.code === 'publication-key-untrusted',
	);
	assert.throws(
		() => requireExternalReleaseEvidence(record, { trustedDistribution: trustedKeyDistribution({ revoked: true }) }),
		(error) => error instanceof ReleaseEvidenceError && error.code === 'publication-key-revoked',
	);
	assert.throws(
		() => requireExternalReleaseEvidence(record, { trustedDistribution: trustedKeyDistribution({ notAfter: '2026-07-28T12:04:59.000Z' }) }),
		(error) => error instanceof ReleaseEvidenceError && error.code === 'publication-key-outside-validity',
	);
});

test('published artifact evidence cannot claim publication before its verified runner completed', () => {
	assert.throws(
		() => requireExternalReleaseEvidence(localRecord({
			classification: RELEASE_EVIDENCE_CLASSES.PUBLISHED_ARTIFACT,
			execution: { runner: 'linux-x64-release', completedAt: '2026-07-28T12:05:00Z' },
			publication: { uri: `https://ghcr.io/acme/terminay@sha256:${SHA}`, publishedAt: '2026-07-28T12:04:59.999Z', signerKeyId: 'terminay-release-2026' },
		})),
		(error) => error instanceof ReleaseEvidenceError && error.code === 'publication-before-execution',
	);
});
