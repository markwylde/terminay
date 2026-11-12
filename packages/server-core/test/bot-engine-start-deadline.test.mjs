import assert from 'node:assert/strict';
import test from 'node:test';
import { EngineCommandError, SocketDriver } from '../dist/botService/index.js';

// --- bot-failure-resilience: start deadline and exit status (ADR-0109) ---
import { PassThrough as Pass } from 'node:stream';
import { EventEmitter as Emitter } from 'node:events';

/** A command stream whose engine start and exit the test controls. */
function fakeChild() {
	const child = new Emitter();
	child.stdin = new Pass();
	child.stdout = new Pass();
	child.stderr = new Pass();
	child.killed = false;
	child.kill = () => {
		child.killed = true;
		child.emit('close', null);
	};
	return child;
}
const collect = (child, options) =>
	Object.create(SocketDriver.prototype).collect.call(null, child, options);

test('a slow engine start does not use up the command deadline', async () => {
	const child = fakeChild();
	const done = collect(child, { startDeadlineMs: 400, deadlineMs: 100 });
	// The engine takes longer to start than the command deadline allows.
	setTimeout(() => child.emit('ready'), 150);
	setTimeout(() => child.emit('close', 0), 200);
	assert.equal(await done, '');
	assert.equal(child.killed, false);
});

test('a command still running past its deadline after start rejects with deadline', async () => {
	const child = fakeChild();
	const done = collect(child, { startDeadlineMs: 400, deadlineMs: 50 });
	setTimeout(() => child.emit('ready'), 10);
	await assert.rejects(
		done,
		(e) => e.code === 'deadline' && /deadline exceeded/.test(e.message),
	);
	assert.equal(child.killed, true);
});

test('an engine that never starts the command rejects with deadline', async () => {
	const child = fakeChild();
	await assert.rejects(
		collect(child, { startDeadlineMs: 30, deadlineMs: 1000 }),
		(e) =>
			e.code === 'deadline' &&
			/did not start the command in time/.test(e.message),
	);
});

test('a command exit status is carried on the error', async () => {
	const child = fakeChild();
	const done = collect(child, { deadlineMs: 1000 });
	child.emit('close', 75);
	await assert.rejects(
		done,
		(e) => e instanceof EngineCommandError && e.exitCode === 75,
	);
});
