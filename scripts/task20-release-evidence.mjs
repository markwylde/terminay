import { createHash } from 'node:crypto';
import { verifyDetachedArtifactSignature } from './task20-signature-key-distribution.mjs';

const SHA256 = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$/u;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export const RELEASE_EVIDENCE_CLASSES = Object.freeze({
	LOCAL_CONTRACT: 'local-contract',
	NATIVE_RUNNER: 'native-runner',
	PUBLISHED_ARTIFACT: 'published-artifact',
});

export class ReleaseEvidenceError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'ReleaseEvidenceError';
		this.code = code;
	}
}

/**
 * Validate release evidence without conflating deterministic local checks with
 * release-runner execution or a published, signed artifact. The returned
 * record is deliberately normalized and frozen so callers cannot mutate a
 * verified local record into publication evidence afterwards.
 */
export function validateReleaseEvidence(record) {
	if (!isObject(record)) fail('invalid-record', 'release evidence must be an object');
	if (record.schemaVersion !== 1) fail('invalid-schema', 'release evidence schemaVersion must be 1');
	if (!IDENTIFIER.test(record.evidenceId ?? '')) fail('invalid-evidence-id', 'release evidence id is invalid');
	if (!IDENTIFIER.test(record.artifactId ?? '')) fail('invalid-artifact-id', 'release artifact id is invalid');
	if (!SEMVER.test(record.version ?? '')) fail('invalid-version', 'release version is invalid');
	if (!SHA256.test(record.artifactSha256 ?? '')) fail('invalid-artifact-digest', 'release artifact SHA-256 is invalid');
	if (!SHA256.test(record.manifestSha256 ?? '')) fail('invalid-manifest-digest', 'release manifest SHA-256 is invalid');
	if (!Object.values(RELEASE_EVIDENCE_CLASSES).includes(record.classification)) fail('invalid-classification', 'release evidence classification is invalid');
	if (!Array.isArray(record.commands) || record.commands.length === 0 || record.commands.some((command) => typeof command !== 'string' || command.trim().length === 0)) {
		fail('invalid-commands', 'release evidence must list the commands that produced it');
	}

	const base = {
		schemaVersion: 1,
		evidenceId: record.evidenceId,
		artifactId: record.artifactId,
		version: record.version,
		artifactSha256: record.artifactSha256,
		manifestSha256: record.manifestSha256,
		classification: record.classification,
		commands: Object.freeze(record.commands.map((command) => command.trim())),
	};

	if (record.classification === RELEASE_EVIDENCE_CLASSES.LOCAL_CONTRACT) {
		if (hasPublicationFields(record)) fail('local-claims-publication', 'local contract evidence cannot claim runner execution or publication');
		return Object.freeze(base);
	}

	if (!isObject(record.execution) || !IDENTIFIER.test(record.execution.runner ?? '') || !ISO_INSTANT.test(record.execution.completedAt ?? '')) {
		fail('invalid-execution', 'release-runner evidence requires a runner and UTC completion instant');
	}
	const execution = Object.freeze({ runner: record.execution.runner, completedAt: record.execution.completedAt });
	if (record.classification === RELEASE_EVIDENCE_CLASSES.NATIVE_RUNNER) {
		if (record.publication !== undefined) fail('runner-claims-publication', 'native-runner evidence cannot claim publication');
		return Object.freeze({ ...base, execution });
	}

	if (!isObject(record.publication) || !isImmutableHttpsUrl(record.publication.uri) || !ISO_INSTANT.test(record.publication.publishedAt ?? '') || !IDENTIFIER.test(record.publication.signerKeyId ?? '')) {
		fail('invalid-publication', 'published artifact evidence requires immutable HTTPS URI, UTC publication instant, and signer key id');
	}
	if (Date.parse(record.publication.publishedAt) < Date.parse(record.execution.completedAt)) {
		fail('publication-before-execution', 'published artifact evidence cannot predate its verified runner execution');
	}
	if (digestFromImmutableHttpsUrl(record.publication.uri) !== record.artifactSha256) {
		fail('publication-digest-mismatch', 'published artifact URI digest must match the recorded artifact SHA-256');
	}
	return Object.freeze({
		...base,
		execution,
		publication: Object.freeze({
			uri: record.publication.uri,
			publishedAt: record.publication.publishedAt,
			signerKeyId: record.publication.signerKeyId,
		}),
	});
}

/** Reject evidence that cannot satisfy an external release gate. */
export function requireExternalReleaseEvidence(record, {
	trustedDistribution,
	artifactBytes,
	manifestBytes,
	detachedSignature,
} = {}) {
	const verified = validateReleaseEvidence(record);
	if (verified.classification !== RELEASE_EVIDENCE_CLASSES.PUBLISHED_ARTIFACT) {
		fail('external-evidence-required', 'signed publication requires published-artifact evidence; local or runner-only evidence is insufficient');
	}
	assertTrustedPublicationSigner(verified, trustedDistribution);
	if (!Buffer.isBuffer(artifactBytes) && !(artifactBytes instanceof Uint8Array)) {
		fail('artifact-bytes-required', 'published artifact evidence requires the exact artifact bytes for detached-signature verification');
	}
	if (typeof detachedSignature !== 'string' || detachedSignature.length === 0) {
		fail('detached-signature-required', 'published artifact evidence requires its detached artifact signature');
	}
	const bytes = Buffer.from(artifactBytes);
	if (createHash('sha256').update(bytes).digest('hex') !== verified.artifactSha256) {
		fail('artifact-bytes-digest-mismatch', 'supplied artifact bytes do not match the recorded artifact SHA-256');
	}
	if (!Buffer.isBuffer(manifestBytes) && !(manifestBytes instanceof Uint8Array)) {
		fail('manifest-bytes-required', 'published artifact evidence requires the exact release manifest bytes');
	}
	const normalizedManifestBytes = Buffer.from(manifestBytes);
	if (createHash('sha256').update(normalizedManifestBytes).digest('hex') !== verified.manifestSha256) {
		fail('manifest-bytes-digest-mismatch', 'supplied release manifest bytes do not match the recorded manifest SHA-256');
	}
	try {
		verifyDetachedArtifactSignature({ bytes, signature: detachedSignature, keyId: verified.publication.signerKeyId, sha256: verified.artifactSha256 }, trustedDistribution);
	} catch (error) {
		fail('detached-signature-invalid', error instanceof Error ? error.message : 'published artifact detached signature verification failed');
	}
	return Object.freeze({
		...verified,
		verification: Object.freeze({
			artifactSha256: verified.artifactSha256,
			manifestSha256: verified.manifestSha256,
			signerKeyId: verified.publication.signerKeyId,
		}),
	});
}

function hasPublicationFields(record) {
	return record.execution !== undefined || record.publication !== undefined;
}

function isObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isImmutableHttpsUrl(value) {
	if (typeof value !== 'string' || value.length > 2048) return false;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && url.username === '' && url.password === '' && url.hash === '' && /@sha256:[a-f0-9]{64}$/u.test(url.pathname);
	} catch {
		return false;
	}
}

function digestFromImmutableHttpsUrl(value) {
	const url = new URL(value);
	return url.pathname.slice(-64);
}

/**
 * Publication evidence may name a key only when the caller has already
 * verified its root-signed distribution. This accepts the normalized output
 * of verifyKeyDistribution rather than an artifact-bundled key list, and
 * evaluates the key at the claimed publication instant.
 */
function assertTrustedPublicationSigner(verified, trustedDistribution) {
	if (!trustedDistribution?.keys || !(trustedDistribution.keys instanceof Map)) {
		fail('key-distribution-required', 'published artifact evidence requires a verified root-authenticated signing-key distribution');
	}
	const key = trustedDistribution.keys.get(verified.publication.signerKeyId);
	if (!key) fail('publication-key-untrusted', 'published artifact signer key is not present in the verified key distribution');
	if (key.revoked === true) fail('publication-key-revoked', 'published artifact signer key is revoked');
	const publishedAt = new Date(verified.publication.publishedAt);
	if (!(key.notBefore instanceof Date) || !(key.notAfter instanceof Date) || publishedAt < key.notBefore || publishedAt > key.notAfter) {
		fail('publication-key-outside-validity', 'published artifact signer key was not valid at the claimed publication instant');
	}
}

function fail(code, message) {
	throw new ReleaseEvidenceError(code, message);
}
