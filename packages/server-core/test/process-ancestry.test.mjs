import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import {
	ProcessAncestry,
	terminalFromProcStat,
	terminalFromPs,
} from '../dist/index.js';

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

test('a real child shares this process\'s controlling terminal, or neither has one', async (t) => {
	const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
		stdio: 'ignore',
	});
	t.after(() => child.kill('SIGKILL'));
	await new Promise((resolve) => child.once('spawn', resolve));
	const shares = await new ProcessAncestry().sharesTerminal(
		child.pid,
		process.pid,
	);
	// Under a terminal the child inherits it; under CI neither has one, and a
	// process with no terminal shares it with nobody.
	assert.equal(shares, process.stdin.isTTY === true);
});

test('a detached child never shares the terminal of the shell that spawned it', async (t) => {
	const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
		stdio: 'ignore',
		detached: true,
	});
	t.after(() => child.kill('SIGKILL'));
	await new Promise((resolve) => child.once('spawn', resolve));
	const ancestry = new ProcessAncestry();
	assert.equal(await ancestry.sharesTerminal(child.pid, process.pid), false);
});

test('controlling terminals are read from ps output', () => {
	assert.equal(terminalFromPs('ttys003\n'), 'ttys003');
	assert.equal(terminalFromPs('pts/2\n'), 'pts/2');
	assert.equal(terminalFromPs('??\n'), null);
	assert.equal(terminalFromPs('?\n'), null);
	assert.equal(terminalFromPs(''), undefined);
});

test('controlling terminals are read from /proc stat, after the command name', () => {
	const stat = (name, tty) =>
		`4242 (${name}) S 4000 4242 4000 ${tty} 4242 4194560 1 0 0 0`;
	assert.equal(terminalFromProcStat(stat('codex', 34818)), '34818');
	assert.equal(terminalFromProcStat(stat('a ) b', 34818)), '34818');
	assert.equal(terminalFromProcStat(stat('codex', 0)), null);
	assert.equal(terminalFromProcStat('garbage'), undefined);
});

test('controlling terminals are cached and forgotten with the process', async () => {
	let reads = 0;
	const ancestry = new ProcessAncestry({
		readParent: async () => undefined,
		readTerminal: async (pid) => {
			reads += 1;
			return pid === 7 ? null : 'ttys001';
		},
	});
	assert.equal(await ancestry.sharesTerminal(5, 3), true);
	assert.equal(await ancestry.sharesTerminal(7, 3), false);
	assert.equal(reads, 3);
	await ancestry.sharesTerminal(5, 3);
	assert.equal(reads, 3);
	ancestry.forget(5);
	await ancestry.sharesTerminal(5, 3);
	assert.equal(reads, 4);
	await ancestry.sharesTerminal(5, 3, true);
	assert.equal(reads, 6);
});
