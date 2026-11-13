import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	detectPrivateTmp,
	helperBusy,
	requestUnitRepairIfNeeded,
	UPGRADE_HELPER_WAIT_MS,
} from '../dist/unitRepair.js';

const fixture = (name) =>
	readFile(new URL(`fixtures/mountinfo/${name}`, import.meta.url), 'utf8');

test('a /tmp bound from a systemd private directory is detected, and a host /tmp is not', async () => {
	assert.equal(detectPrivateTmp(await fixture('private-tmp.txt')), true);
	assert.equal(detectPrivateTmp(await fixture('shared-tmp.txt')), false);
	// No /tmp mount of its own: the root file system's /tmp is the host's.
	assert.equal(
		detectPrivateTmp('24 1 259:2 / / rw,relatime shared:1 - ext4 /dev/sda1 rw\n'),
		false,
	);
	// Only the last mount at /tmp is visible.
	const shadowed = `${await fixture('private-tmp.txt')}900 812 0:50 / /tmp rw - tmpfs tmpfs rw\n`;
	assert.equal(detectPrivateTmp(shadowed), false);
	// A private directory mounted somewhere else is not /tmp.
	assert.equal(
		detectPrivateTmp(
			'50 24 259:2 /tmp/systemd-private-x-other.service-y/tmp /srv/scratch rw - ext4 /dev/sda1 rw\n',
		),
		false,
	);
});

/** A machine under a private /tmp, its helper scripted call by call. */
async function harness(t, { helper = [false], requestFile = true } = {}) {
	const root = await mkdtemp(join(tmpdir(), 'terminay-unit-repair-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const requestPath = join(root, 'upgrade-request');
	const mountinfo = await fixture('private-tmp.txt');
	let clock = 1_000_000;
	const events = [];
	const answers = [...helper];
	const diagnostics = [];
	const dependencies = {
		dataRoot: root,
		requestFile: async () => (requestFile ? requestPath : undefined),
		readMountinfo: async () => mountinfo,
		readBootId: async () => 'boot-1\n',
		helperActive: async () => {
			const active = answers.length > 1 ? answers.shift() : answers[0];
			events.push(active ? 'helper-active' : 'helper-inactive');
			return active;
		},
		sleep: async (ms) => {
			events.push(`sleep ${ms}`);
			clock += ms;
		},
		now: () => clock,
		onDiagnostic: (message) => diagnostics.push(message),
	};
	const requested = async () =>
		readFile(requestPath, 'utf8').then(
			(text) => text,
			() => undefined,
		);
	return { root, requestPath, dependencies, events, diagnostics, requested };
}

test('an idle helper is asked at once, with an owner-only request file', async (t) => {
	const h = await harness(t);
	assert.equal(await requestUnitRepairIfNeeded(h.dependencies), 'requested');
	assert.deepEqual(h.events, ['helper-inactive']);
	assert.equal(await h.requested(), '1000000\n');
	assert.equal((await stat(h.requestPath)).mode & 0o777, 0o600);
	const record = JSON.parse(
		await readFile(join(h.root, 'unit-repair-request.json'), 'utf8'),
	);
	assert.equal(record.bootId, 'boot-1');
});

test('a running helper is waited for, and asked only once it has finished', async (t) => {
	const h = await harness(t, { helper: [true, true, true, false] });
	assert.equal(await requestUnitRepairIfNeeded(h.dependencies), 'requested');
	assert.deepEqual(h.events, [
		'helper-active',
		'sleep 1000',
		'helper-active',
		'sleep 2000',
		'helper-active',
		'sleep 4000',
		'helper-inactive',
	]);
	assert.equal(await h.requested(), '1007000\n');
});

test('a helper that never finishes is not asked, and the operator is told what to run', async (t) => {
	const h = await harness(t, { helper: [true] });
	assert.equal(await requestUnitRepairIfNeeded(h.dependencies), 'needed');
	assert.equal(await h.requested(), undefined);
	// Bounded by the helper's own start timeout, with a capped backoff.
	const slept = h.events
		.filter((event) => event.startsWith('sleep '))
		.map((event) => Number(event.slice(6)));
	assert.ok(slept.reduce((sum, ms) => sum + ms, 0) >= UPGRADE_HELPER_WAIT_MS);
	assert.ok(Math.max(...slept) <= 30_000);
	assert.match(h.diagnostics.at(-1), /terminay daemon upgrade/u);
});

test('the request is made at most once per boot', async (t) => {
	const h = await harness(t);
	assert.equal(await requestUnitRepairIfNeeded(h.dependencies), 'requested');
	await rm(h.requestPath);
	assert.equal(await requestUnitRepairIfNeeded(h.dependencies), 'needed');
	assert.equal(await h.requested(), undefined);
	assert.match(h.diagnostics.at(-1), /already requested this boot/u);

	// A new boot may ask again.
	assert.equal(
		await requestUnitRepairIfNeeded({
			...h.dependencies,
			readBootId: async () => 'boot-2\n',
		}),
		'requested',
	);
});

test('with no helper to ask, as for a user-scope install, the operator is told what to run', async (t) => {
	const h = await harness(t, { requestFile: false });
	assert.equal(await requestUnitRepairIfNeeded(h.dependencies), 'needed');
	assert.deepEqual(h.events, []);
	assert.match(
		h.diagnostics.join('\n'),
		/private \/tmp[\s\S]*run `terminay daemon upgrade`/u,
	);
});

test('a server under the host /tmp does nothing', async (t) => {
	const h = await harness(t);
	assert.equal(
		await requestUnitRepairIfNeeded({
			...h.dependencies,
			readMountinfo: () => fixture('shared-tmp.txt'),
		}),
		'not-needed',
	);
	assert.deepEqual(h.events, []);
	assert.deepEqual(h.diagnostics, []);
});

test('a failure while asking is reported, never thrown', async (t) => {
	const h = await harness(t);
	await writeFile(join(h.root, 'blocker'), '');
	assert.equal(
		await requestUnitRepairIfNeeded({
			...h.dependencies,
			dataRoot: join(h.root, 'blocker'),
		}),
		'needed',
	);
	assert.match(h.diagnostics.at(-1), /could not be requested/u);
});

test('a oneshot that is still running counts as busy, as systemctl reports it', () => {
	for (const state of ['active', 'activating\n', 'deactivating', 'reloading', 'refreshing'])
		assert.equal(helperBusy(state), true, state);
	for (const state of ['inactive\n', 'failed', 'unknown', ''])
		assert.equal(helperBusy(state), false, state);
});
