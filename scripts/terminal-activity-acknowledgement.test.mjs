import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const { shouldAcknowledgeInteractedActivity } = await importAcknowledgement();

test('project activation without interaction does not acknowledge finished work', () => {
	assert.equal(
		shouldAcknowledgeInteractedActivity({
			acknowledged: false,
			claimed: false,
			focusedSessionId: 'terminal-1',
			interactedSessionId: null,
			sessionId: 'terminal-1',
			status: 'idle',
			windowFocused: true,
		}),
		false,
	);
});

test('a shell command finishing in the terminal the user is in is acknowledged', () => {
	assert.equal(
		shouldAcknowledgeInteractedActivity({
			acknowledged: false,
			claimed: false,
			focusedSessionId: 'terminal-1',
			interactedSessionId: 'terminal-1',
			sessionId: 'terminal-1',
			status: 'idle',
			windowFocused: true,
		}),
		true,
	);
});

test('working stays live even while the user is in the terminal', () => {
	assert.equal(
		shouldAcknowledgeInteractedActivity({
			acknowledged: false,
			claimed: false,
			focusedSessionId: 'terminal-1',
			interactedSessionId: 'terminal-1',
			sessionId: 'terminal-1',
			status: 'working',
			windowFocused: true,
		}),
		false,
	);
});

test('a terminal typed in earlier is not acknowledged once focus has moved on', () => {
	assert.equal(
		shouldAcknowledgeInteractedActivity({
			acknowledged: false,
			claimed: false,
			focusedSessionId: 'terminal-2',
			interactedSessionId: 'terminal-1',
			sessionId: 'terminal-1',
			status: 'idle',
			windowFocused: true,
		}),
		false,
	);
});

test('a terminal the user typed in is not acknowledged once they have left the window', () => {
	assert.equal(
		shouldAcknowledgeInteractedActivity({
			acknowledged: false,
			claimed: false,
			focusedSessionId: 'terminal-1',
			interactedSessionId: 'terminal-1',
			sessionId: 'terminal-1',
			status: 'idle',
			windowFocused: false,
		}),
		false,
	);
});

test('an agent finishing in the terminal the user is in is not acknowledged', () => {
	assert.equal(
		shouldAcknowledgeInteractedActivity({
			acknowledged: false,
			claimed: true,
			focusedSessionId: 'terminal-1',
			interactedSessionId: 'terminal-1',
			sessionId: 'terminal-1',
			status: 'idle',
			windowFocused: true,
		}),
		false,
	);
});

async function importAcknowledgement() {
	const tempDir = await mkdtemp(
		join(tmpdir(), 'terminay-activity-acknowledgement-'),
	);
	const outputPath = join(tempDir, 'acknowledgement.mjs');
	await build({
		bundle: true,
		entryPoints: [
			new URL(
				'../src/workspace/terminalActivityAcknowledgement.ts',
				import.meta.url,
			).pathname,
		],
		format: 'esm',
		outfile: outputPath,
		platform: 'neutral',
		target: 'es2022',
	});
	return import(outputPath);
}

import { CoalescedSessionAcknowledgements } from '../src/workspace/coalescedAcknowledgements.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('an acknowledgement burst keeps one request in flight and one trailing per session', async () => {
  const calls = []; const gates = [];
  const queue = new CoalescedSessionAcknowledgements(sessionId => { calls.push(sessionId); const gate = deferred(); gates.push(gate); return gate.promise; });
  for (let i = 0; i < 100; i++) queue.acknowledge('one');
  queue.acknowledge('two');
  assert.deepEqual(calls, ['one', 'two']);
  gates[0].resolve(); await tick();
  assert.deepEqual(calls, ['one', 'two', 'one']);
  gates[1].resolve(); gates[2].resolve(); await tick();
  assert.deepEqual(calls, ['one', 'two', 'one']);
  queue.acknowledge('one'); assert.equal(calls.length, 4);
  gates[3].resolve(); await tick();
});

test('acknowledgement kinds stay independent and a failed request retains its trailing interaction', async () => {
  const first = deferred(); const calls = [];
  const activity = new CoalescedSessionAcknowledgements(() => { calls.push('activity'); return calls.filter(kind => kind === 'activity').length === 1 ? first.promise : undefined; });
  const agent = new CoalescedSessionAcknowledgements(() => { calls.push('agent'); });
  activity.acknowledge('session'); activity.acknowledge('session'); agent.acknowledge('session');
  assert.deepEqual(calls, ['activity', 'agent']);
  first.reject(new Error('temporary failure')); await tick();
  assert.deepEqual(calls, ['activity', 'agent', 'activity']);
});

test('view cleanup cancels unsent trailing work without suppressing later lifecycle interactions', async () => {
  const first = deferred(); const calls = [];
  const queue = new CoalescedSessionAcknowledgements(() => { calls.push('ack'); return calls.length === 1 ? first.promise : undefined; });
  queue.acknowledge('session'); queue.acknowledge('session'); queue.clear();
  queue.acknowledge('session'); first.resolve(); await tick();
  assert.deepEqual(calls, ['ack', 'ack']);
  queue.acknowledge('session'); await tick();
  assert.equal(calls.length, 3);
});
