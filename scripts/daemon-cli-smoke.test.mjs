import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import {
	CONTAINER_DRIVER,
	isSmokeEnabled,
	runDaemonSmoke,
	SMOKE_STEPS,
} from './daemon-cli-smoke.mjs';

test('the smoke is opt-in so an ordinary run never needs a privileged container', () => {
	assert.equal(isSmokeEnabled({}), false);
	assert.equal(isSmokeEnabled({ TERMINAY_RUN_DAEMON_SMOKE: '0' }), false);
	assert.equal(isSmokeEnabled({ TERMINAY_RUN_DAEMON_SMOKE: '1' }), true);
});

test('the smoke drives the whole documented lifecycle', () => {
	assert.deepEqual(
		[...SMOKE_STEPS],
		[
			'install',
			'workspace UI',
			'status',
			'upgrade',
			'qr-code --no-wait',
			'uninstall',
		],
	);
	for (const step of SMOKE_STEPS) {
		assert.ok(
			CONTAINER_DRIVER.includes(`--- ${step} ---`),
			`the driver must run ${step}`,
		);
	}
});

test('the smoke asserts against systemd itself, not against the CLI it just ran', () => {
	// The whole point of paying for a privileged container is asking systemd
	// what it believes, rather than trusting the command that just returned.
	assert.match(
		CONTAINER_DRIVER,
		/systemctl\('cat', 'terminay-server\.service'\)/u,
	);
	assert.match(
		CONTAINER_DRIVER,
		/systemctl\('is-enabled', 'terminay-server\.service'\)/u,
	);
	assert.match(
		CONTAINER_DRIVER,
		/systemctl\('is-active', 'terminay-server\.service'\)/u,
	);
	assert.match(CONTAINER_DRIVER, /systemd must no longer know the unit/u);
});

test('the smoke installs a local archive rather than reaching for a release', () => {
	assert.match(CONTAINER_DRIVER, /localArchivePath/u);
	assert.doesNotMatch(CONTAINER_DRIVER, /api\.github\.com/u);
});

test('the local-archive seam is a source install, so it is never a signature bypass', async () => {
	const source = await readFile(
		resolve('apps/terminay-cli/src/commands/install.ts'),
		'utf8',
	);
	// A local archive has no publisher, exactly like a source build, and the
	// spec already allows that path to install without a signature. What it must
	// not do is skip the manifest check or reach the signed download path with
	// verification turned off.
	assert.match(source, /channel: 'source' as const, version: 'local'/u);
	assert.doesNotMatch(source, /skipVerification|allowUnsigned/u);

	const cli = await readFile(resolve('apps/terminay-cli/src/cli.ts'), 'utf8');
	assert.doesNotMatch(
		cli,
		/localArchivePath/u,
		'the shipped binary must never install an unsigned local archive',
	);
});

test('the container smoke passes when it is opted into', {
	skip: !isSmokeEnabled(),
}, async () => {
	await runDaemonSmoke();
});
