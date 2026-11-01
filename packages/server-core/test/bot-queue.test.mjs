import assert from 'node:assert/strict';
import test from 'node:test';
import { BotTurnQueue } from '../dist/botService/index.js';

const botId = 'abc123def456';
const chat = (id) => ({
	botId,
	sessionId: id,
	origin: { kind: 'chat' },
	prompt: id,
});
const trigger = (id, fireTime = 0) => ({
	botId,
	sessionId: id,
	origin: { kind: 'trigger', triggerId: id, triggerName: id, fireTime },
	prompt: id,
});
const flush = () => new Promise((resolve) => setImmediate(resolve));
function queue() {
	const runs = [],
		suspended = [],
		cancelled = [];
	let finish;
	const q = new BotTurnQueue({
		run: async (item) => {
			runs.push(item);
			await new Promise((r) => {
				finish = r;
			});
		},
		suspend: async (id) => suspended.push(id),
		cancelled: (...a) => cancelled.push(a),
		changed() {},
		failure() {},
	});
	return { q, runs, suspended, cancelled, finish: () => finish() };
}
test('5.4 one queued message per session across devices, input snapshots and cap of twenty', () => {
	const { q } = queue();
	q.enqueue(chat('active'));
	const input = chat('same');
	q.enqueue(input);
	input.prompt = 'mutated';
	assert.equal(q.list(botId)[0].prompt, 'same');
	assert.throws(() => q.enqueue(chat('same')), /already queued/);
	for (let n = 0; n < 19; n++) q.enqueue(chat(`q${n}`));
	assert.equal(q.list(botId).length, 20);
	assert.throws(() => q.enqueue(chat('overflow')), /queue is full/);
});
test('5.4 idle chat suspends before another turn; chat and triggers alternate with time ordering', async () => {
	const { q, runs, suspended, finish } = queue();
	q.enqueue(chat('initial'));
	q.enqueue(trigger('later', 20));
	q.enqueue(trigger('earlier', 10));
	q.enqueue(chat('one'));
	q.enqueue(chat('two'));
	finish();
	await flush();
	assert.equal(runs[1].sessionId, 'earlier');
	assert.deepEqual(suspended, ['initial']);
	finish();
	await flush();
	assert.equal(runs[2].sessionId, 'one');
	finish();
	await flush();
	assert.equal(runs[3].sessionId, 'later');
	finish();
	await flush();
	assert.equal(runs[4].sessionId, 'two');
	finish();
	await flush();
});
test('5.4 one pending firing per trigger, cancel queued items, disable removes the pending firing', () => {
	const { q, cancelled } = queue();
	q.enqueue(chat('active'));
	const item = q.enqueue(chat('queued'));
	q.cancel(botId, item.id);
	assert.equal(cancelled.length, 1);
	q.enqueue(trigger('t'));
	assert.throws(() => q.enqueue(trigger('t')), /already queued/);
	q.disableTrigger(botId, 't');
	assert.equal(q.list(botId).length, 0);
});
test('5.4 between-turn chat keeps its process only until work waits', async () => {
	const { q, runs, suspended, finish } = queue();
	q.enqueue(chat('chat'));
	finish();
	await flush();
	assert.deepEqual(suspended, []);
	q.enqueue(trigger('t'));
	await flush();
	assert.deepEqual(suspended, ['chat']);
	assert.equal(runs[1].sessionId, 't');
	finish();
	await flush();
});
