const SHA256_DIGEST = /^[a-f0-9]{64}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const GIT_REVISION = /^[a-f0-9]{40}$/u;

export class ReleaseImageDeploymentError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'ReleaseImageDeploymentError';
		this.code = code;
	}
}

/**
 * Validate the checked-in/operator-supplied image lock used for a controlled
 * deployment. OCI tags are intentionally not accepted here: the lock is the
 * point at which a release selection becomes immutable.
 */
export function validateImageDeploymentLock(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new ReleaseImageDeploymentError('invalid-lock', 'image deployment lock must be an object');
	}
	if (value.schemaVersion !== 1) {
		throw new ReleaseImageDeploymentError('invalid-schema', 'image deployment lock schemaVersion must be 1');
	}
	if (typeof value.owner !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/u.test(value.owner)) {
		throw new ReleaseImageDeploymentError('invalid-owner', 'image deployment lock owner is invalid');
	}
	if (typeof value.version !== 'string' || !SEMVER.test(value.version)) {
		throw new ReleaseImageDeploymentError('invalid-version', 'image deployment lock version must be semantic version text');
	}
	if (typeof value.revision !== 'string' || !GIT_REVISION.test(value.revision)) {
		throw new ReleaseImageDeploymentError('invalid-revision', 'image deployment lock revision must be a full lowercase git SHA');
	}
	if (!value.images || typeof value.images !== 'object' || Array.isArray(value.images)) {
		throw new ReleaseImageDeploymentError('invalid-images', 'image deployment lock must contain server and web images');
	}
	const server = parseImage(value.images.server, value.owner, 'terminay-server');
	const web = parseImage(value.images.web, value.owner, 'terminay-web');
	if (server.digest === web.digest) {
		throw new ReleaseImageDeploymentError('duplicate-digest', 'server and web image digests must be distinct');
	}
	return Object.freeze({
		schemaVersion: 1,
		owner: value.owner,
		version: value.version,
		revision: value.revision,
		images: Object.freeze({ server: server.reference, web: web.reference }),
	});
}

function parseImage(value, owner, name) {
	if (typeof value !== 'string') {
		throw new ReleaseImageDeploymentError('invalid-image', `${name} image must be a string`);
	}
	const expected = `ghcr.io/${owner}/${name}@sha256:`;
	if (!value.startsWith(expected) || value.length !== expected.length + 64) {
		throw new ReleaseImageDeploymentError('invalid-image', `${name} image must be exactly ${expected}<64 lowercase hex characters>`);
	}
	const digest = value.slice(expected.length);
	if (!SHA256_DIGEST.test(digest)) {
		throw new ReleaseImageDeploymentError('invalid-digest', `${name} image digest must be 64 lowercase hexadecimal characters`);
	}
	return Object.freeze({ digest, reference: value });
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const path = process.argv[2];
	if (typeof path !== 'string' || process.argv.length !== 3) {
		console.error('Usage: node scripts/release-image-deployment.mjs <deployment-images.json>');
		process.exitCode = 2;
	} else {
		const { readFile } = await import('node:fs/promises');
		try {
			const lock = validateImageDeploymentLock(JSON.parse(await readFile(path, 'utf8')));
			console.log(JSON.stringify(lock, null, 2));
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = 1;
		}
	}
}
