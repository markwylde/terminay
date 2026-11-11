import assert from 'node:assert/strict';
import test from 'node:test';
import {BotTurnQueue} from '../dist/botService/index.js';
const botId='abc123def456';
const item=(id,kind='chat')=>({botId,sessionId:id,origin:kind==='chat'?{kind}:{kind:'trigger',triggerId:id,triggerName:id,fireTime:0},prompt:id});
function fixture(){const runs=[],ends=new Map(),cancelled=[];const q=new BotTurnQueue({run:async i=>{runs.push(i);await new Promise((resolve,reject)=>ends.set(i.sessionId,{resolve,reject}));},suspend:async()=>assert.fail('No idle execution retention'),cancelled:i=>cancelled.push(i),changed(){},failure(){}});return {q,runs,ends,cancelled};}
const flush=()=>new Promise(r=>setImmediate(r));
test('four work executions leave one reserved user-message coordination slot',async()=>{const {q,runs,ends}=fixture();for(let n=0;n<4;n++)q.enqueue(item(`work${n}`,'trigger'));q.enqueue(item('waiting','trigger'));q.enqueue(item('correction'));assert.equal(runs.length,5);assert.equal(runs[4].coordinationOnly,true);assert.equal(q.promote(botId,'correction'),false);ends.get('work0').resolve();await flush();assert.equal(q.promote(botId,'correction'),false);assert.equal(runs[5].sessionId,'waiting');for(const end of ends.values())end.resolve();await flush();});
test('waiting admission is bounded, copied, cancellable and trigger disable scoped',async()=>{const {q,cancelled,ends}=fixture();for(let n=0;n<5;n++)q.enqueue(item(`active${n}`));const input=item('waiting');q.enqueue(input);input.prompt='mutated';assert.equal(q.list(botId)[0].prompt,'waiting');assert.throws(()=>q.enqueue(item('waiting')),/full or blocked/);for(let n=0;n<19;n++)q.enqueue(item(`queued${n}`));assert.throws(()=>q.enqueue(item('overflow')),/full or blocked/);q.cancel(botId,q.list(botId)[0].id);assert.equal(cancelled.length,1);await q.block(botId);assert.equal(q.list(botId).length,0);for(const end of ends.values())end.resolve();await flush();});
test('a failure other than cleanup blocks admission at once until reconciliation resets the lane',async()=>{const {q,ends}=fixture();q.enqueue(item('bad'));ends.get('bad').reject(new Error('cleanup failed'));await flush();assert.throws(()=>q.enqueue(item('new')),/blocked/);assert.throws(()=>q.unblock(botId),/reconciled/);q.unblock(botId,true);q.enqueue(item('new'));ends.get('new').resolve();await flush();});
test('replacement reserves freed admission for the correction before unrelated queued work',async()=>{const {q,runs,ends}=fixture();for(let n=0;n<4;n++)q.enqueue(item(`work${n}`,'trigger'));q.enqueue(item('waiting','trigger'));q.enqueue(item('correction'));const release=q.reservePromotion(botId,'correction','work0');ends.get('work0').resolve();await flush();assert.equal(runs.length,5);assert.equal(q.promote(botId,'correction','work0'),true);release();assert.equal(runs.length,5);ends.get('correction').resolve();await flush();assert.equal(runs.at(-1).sessionId,'waiting');for(const end of ends.values())end.resolve();await flush();});
function counted() {
	const runs = [],
		ends = new Map(),
		cancelled = [],
		failures = [];
	const q = new BotTurnQueue({
		run: async (i) => {
			runs.push(i);
			return await new Promise((resolve, reject) =>
				ends.set(i.sessionId, { resolve, reject }),
			);
		},
		suspend: async () => {},
		cancelled: (i, reason) => cancelled.push({ id: i.sessionId, reason }),
		changed() {},
		failure: async (i, f) => failures.push({ id: i.sessionId, ...f }),
	});
	const failed = { cleanup: 'failed', error: new Error('kill timed out') };
	const ok = { cleanup: 'ok' };
	return { q, runs, ends, cancelled, failures, failed, ok };
}
test('two cleanup failures keep admitting and a confirmed cleanup resets the count', async () => {
	const r = counted();
	for (const id of ['a', 'b']) {
		r.q.enqueue(item(id));
		r.ends.get(id).resolve(r.failed);
		await flush();
	}
	assert.deepEqual(
		r.failures.map((f) => [f.id, f.cleanup, f.blocked]),
		[
			['a', true, false],
			['b', true, false],
		],
	);
	r.q.enqueue(item('c'));
	r.ends.get('c').resolve(r.ok);
	await flush();
	for (const id of ['d', 'e']) {
		r.q.enqueue(item(id));
		r.ends.get(id).resolve(r.failed);
		await flush();
	}
	r.q.enqueue(item('f'));
	assert.equal(r.runs.at(-1).sessionId, 'f');
	assert.ok(r.failures.every((f) => !f.blocked));
	r.ends.get('f').resolve(r.ok);
	await flush();
});
test('the third consecutive cleanup failure blocks, cancels waiting work and needs reconciliation', async () => {
	const r = counted();
	for (const id of ['a', 'b', 'c', 'd', 'w1', 'w2', 'waiting'])
		r.q.enqueue(item(id, 'trigger'));
	for (const id of ['a', 'b', 'c']) {
		r.ends.get(id).resolve(r.failed);
		await flush();
	}
	assert.deepEqual(
		r.failures.map((f) => f.blocked),
		[false, false, true],
	);
	assert.ok(r.cancelled.some((c) => c.id === 'waiting'));
	assert.throws(() => r.q.enqueue(item('new')), /blocked/);
	assert.throws(() => r.q.unblock(botId), /reconciled/);
	// d, w1 and w2 started before the block; their confirmed cleanup must not unblock.
	for (const id of ['d', 'w1', 'w2']) r.ends.get(id).resolve(r.ok);
	await flush();
	assert.throws(() => r.q.enqueue(item('new')), /blocked/);
	r.q.unblock(botId, true);
	for (const id of ['x', 'y']) {
		r.q.enqueue(item(id));
		r.ends.get(id).resolve(r.failed);
		await flush();
	}
	r.q.enqueue(item('z'));
	assert.equal(r.runs.at(-1).sessionId, 'z');
	r.ends.get('z').resolve(r.ok);
	await flush();
});
test('consecutive means finish order across concurrent executions', async () => {
	const r = counted();
	for (const id of ['a', 'b', 'c']) r.q.enqueue(item(id, 'trigger'));
	r.ends.get('b').resolve(r.failed);
	await flush();
	r.ends.get('c').resolve(r.failed);
	await flush();
	r.ends.get('a').resolve(r.ok);
	await flush();
	for (const id of ['d', 'e']) {
		r.q.enqueue(item(id));
		r.ends.get(id).resolve(r.failed);
		await flush();
	}
	r.q.enqueue(item('f'));
	assert.ok(r.failures.every((f) => !f.blocked));
	r.ends.get('f').resolve(r.ok);
	await flush();
});
test('a failure hook that rejects does not wedge the lane', async (t) => {
	const logged = [];
	t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
	const runs = [],
		ends = new Map();
	const q = new BotTurnQueue({
		run: async (i) => {
			runs.push(i);
			return await new Promise((resolve) => ends.set(i.sessionId, resolve));
		},
		suspend: async () => {},
		cancelled() {},
		changed() {},
		failure: async () => {
			throw new Error('store unavailable');
		},
	});
	q.enqueue(item('a'));
	ends.get('a')({ cleanup: 'failed', error: new Error('x') });
	await flush();
	await flush();
	assert.ok(logged.some((l) => l.includes('bot failure hook failed')));
	q.enqueue(item('b'));
	assert.equal(runs.at(-1).sessionId, 'b');
	ends.get('b')({ cleanup: 'ok' });
	await flush();
});
