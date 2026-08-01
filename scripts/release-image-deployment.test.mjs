import assert from 'node:assert/strict';
import test from 'node:test';
import { ReleaseImageDeploymentError, validateImageDeploymentLock } from './release-image-deployment.mjs';

const digest = (character) => character.repeat(64);

function lock(overrides = {}) {
	return {
		schemaVersion: 1,
		owner: 'terminay-dev',
		version: '1.2.3',
		revision: 'a'.repeat(40),
		images: {
			server: `ghcr.io/terminay-dev/terminay-server@sha256:${digest('b')}`,
			web: `ghcr.io/terminay-dev/terminay-web@sha256:${digest('c')}`,
		},
		...overrides,
	};
}

test('deployment image locks require exact independent GHCR digest references', () => {
	assert.deepEqual(validateImageDeploymentLock(lock()), lock());
});

test('deployment image locks reject mutable, credentialed, cross-owner, and malformed references', () => {
	for (const replacement of [
		'ghcr.io/terminay-dev/terminay-server:latest',
		`https://ghcr.io/terminay-dev/terminay-server@sha256:${digest('b')}`,
		`ghcr.io/other/terminay-server@sha256:${digest('b')}`,
		`ghcr.io/terminay-dev/terminay-web@sha256:${digest('b')}`,
		`ghcr.io/terminay-dev/terminay-server@sha256:${'B'.repeat(64)}`,
	]) {
		assert.throws(
			() => validateImageDeploymentLock(lock({ images: { ...lock().images, server: replacement } })),
			ReleaseImageDeploymentError,
		);
	}
});

test('deployment image locks fail closed on changed release identity and image-digest reuse', () => {
	for (const candidate of [
		lock({ schemaVersion: 2 }),
		lock({ owner: 'Terminay' }),
		lock({ version: 'v1.2.3' }),
		lock({ revision: 'a'.repeat(39) }),
		lock({ images: { ...lock().images, web: lock().images.server } }),
	]) {
		assert.throws(() => validateImageDeploymentLock(candidate), ReleaseImageDeploymentError);
	}
});
