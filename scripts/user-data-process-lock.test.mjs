import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'terminay-user-data-lock-'));
const output = join(directory, 'userDataProcessLock.mjs');
await build({
	bundle: true,
	entryPoints: ['electron/userDataProcessLock.ts'],
	format: 'esm',
	logLevel: 'silent',
	outfile: output,
	platform: 'node',
	target: 'node20',
});
const { acquireUserDataProcessLock } = await import(pathToFileURL(output).href);
test.after(async () => rm(directory, { recursive: true, force: true }));

test('a live process keeps exclusive ownership of one user-data root', () => {
	const root = join(directory, 'profile');
	const first = acquireUserDataProcessLock(root, { pid: 4_241, isPidAlive: () => true });
	assert.ok(first);
	assert.equal(
		acquireUserDataProcessLock(root, { pid: 4_242, isPidAlive: (pid) => pid === 4_241 }),
		undefined,
	);
	first.release();
	const second = acquireUserDataProcessLock(root, { pid: 4_242, isPidAlive: () => false });
	assert.ok(second);
	second.release();
});

test('a rebuild can take over after the previous owner exits during the retry window', () => {
	const root = join(directory, 'rebuild');
	let ownerAlive = true;
	const first = acquireUserDataProcessLock(root, { pid: 8_001, isPidAlive: () => true });
	assert.ok(first);
	const sleeps = [];
	const replacement = acquireUserDataProcessLock(root, {
		pid: 8_002,
		retryAttempts: 3,
		retryDelayMs: 10,
		isPidAlive: () => ownerAlive,
		sleep() {
			sleeps.push(1);
			ownerAlive = false;
			first.release();
		},
	});
	assert.ok(replacement);
	assert.equal(sleeps.length, 1);
	replacement.release();
});

test('a leftover lock from a dead process can be replaced', () => {
	const root = join(directory, 'stale');
	const crashed = acquireUserDataProcessLock(root, { pid: 7_001, isPidAlive: () => true });
	assert.ok(crashed);
	const replacement = acquireUserDataProcessLock(root, {
		pid: 7_002,
		isPidAlive: (pid) => pid === 7_002,
	});
	assert.ok(replacement);
	replacement.release();
});
