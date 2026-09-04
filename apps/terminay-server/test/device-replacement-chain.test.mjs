import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeviceReplacementChain } from '../src/remote/hostedPeerLifecycle.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

test('two peers for one device take over in order', async () => {
	const chain = createDeviceReplacementChain();
	const order = [];
	let releaseFirst;
	const first = chain.run('device-a', async () => {
		order.push('first:start');
		await new Promise((resolve) => { releaseFirst = resolve; });
		order.push('first:end');
	});
	const second = chain.run('device-a', async () => {
		order.push('second:start');
	});
	await settle();
	assert.deepEqual(order, ['first:start'], 'the replacement waits for the peer it replaces');
	releaseFirst();
	await Promise.all([first, second]);
	assert.deepEqual(order, ['first:start', 'first:end', 'second:start']);
});

test('another device never waits on a slow takeover', async () => {
	const chain = createDeviceReplacementChain();
	const done = [];
	const slow = chain.run('device-a', () => new Promise(() => {}));
	void slow.catch(() => undefined);
	await chain.run('device-b', async () => { done.push('device-b'); });
	assert.deepEqual(done, ['device-b']);
});

test('a failed takeover does not block the next one, and drained chains are dropped', async () => {
	const chain = createDeviceReplacementChain();
	await assert.rejects(chain.run('device-a', async () => { throw new Error('cleanup failed'); }), /cleanup failed/u);
	assert.equal(await chain.run('device-a', async () => 'next'), 'next');
	await settle();
	assert.equal(chain.size, 0, 'the chain is not retained per device id forever');
});
