import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { ProcessAncestry } from '../dist/index.js';

test('a real child process descends from the shell pid that spawned it', async (t) => {
	// This test process stands in for a PTY shell; the child is the agent.
	const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
		stdio: 'ignore',
	});
	t.after(() => child.kill('SIGKILL'));
	await new Promise((resolve) => child.once('spawn', resolve));
	const ancestry = new ProcessAncestry();
	const shells = new Set([process.pid]);
	const chain = await ancestry.chain(child.pid, shells);
	assert.equal(chain[0], child.pid);
	assert.equal(ProcessAncestry.owner(chain, shells), process.pid);
	// Reading stops at the shell: nothing above it is read.
	assert.equal(chain.at(-1), process.pid);
});

test('an unrelated process belongs to no shell', async () => {
	const ancestry = new ProcessAncestry({
		readParent: async (pid) => ({ 50: 40, 40: 1 })[pid],
	});
	const chain = await ancestry.chain(50, new Set([30]));
	assert.deepEqual(chain, [50, 40, 1]);
	assert.equal(ProcessAncestry.owner(chain, new Set([30])), undefined);
});

test('chains are cached, bounded, and forgotten through a shell', async () => {
	let reads = 0;
	const ancestry = new ProcessAncestry({
		maxHops: 3,
		readParent: async (pid) => {
			reads += 1;
			return pid + 1;
		},
	});
	const chain = await ancestry.chain(10);
	assert.deepEqual(chain, [10, 11, 12, 13]);
	assert.equal(reads, 3);
	await ancestry.chain(10);
	assert.equal(reads, 3);
	ancestry.forgetThrough(12);
	assert.equal(ancestry.cached(10), undefined);
});

test('a vanished process yields a chain of itself', async () => {
	const ancestry = new ProcessAncestry({ readParent: async () => undefined });
	assert.deepEqual(await ancestry.chain(77), [77]);
});

test('the default reader spawns nothing until asked', async (t) => {
	// Constructing the reader and holding cached chains must not touch the
	// process table; reads happen only inside `chain()`. Time is the test's:
	// anything the reader scheduled would run when the clock is advanced.
	t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'setImmediate'] });
	let reads = 0;
	const ancestry = new ProcessAncestry({
		readParent: async () => {
			reads += 1;
			return undefined;
		},
	});
	t.mock.timers.tick(24 * 60 * 60 * 1000);
	await Promise.resolve();
	assert.equal(reads, 0);
	t.mock.timers.reset();
	await ancestry.chain(5);
	assert.equal(reads, 1);
});
