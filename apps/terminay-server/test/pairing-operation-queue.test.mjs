import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createPairingOperationQueue,
	createSharedPairingHandoffRotator,
} from '../src/remote/pairingOperationQueue.ts';

test('concurrent hosted and direct refreshes adopt one shared room per generation', async () => {
	let rotations = 0;
	const initial = Object.freeze({ room: 'room-0' });
	const rotate = createSharedPairingHandoffRotator({
		modes: ['hosted', 'direct'],
		initialHandoff: initial,
		rotate: () => Object.freeze({ room: `room-${++rotations}` }),
	});

	const [hostedFirst, directFirst] = await Promise.all([
		rotate('hosted'),
		rotate('direct'),
	]);
	assert.equal(rotations, 1);
	assert.strictEqual(hostedFirst, directFirst);

	const [hostedRefresh, duplicateHostedRefresh, directRefresh] =
		await Promise.all([
			rotate('hosted'),
			rotate('hosted'),
			rotate('direct'),
		]);
	assert.equal(rotations, 2);
	assert.strictEqual(hostedRefresh, duplicateHostedRefresh);
	assert.strictEqual(hostedRefresh, directRefresh);
	assert.equal(hostedRefresh.room, 'room-2');
});

test('an unexposed server can compose without a pairing rotation mode', async () => {
	const rotate = createSharedPairingHandoffRotator({
		modes: [],
		initialHandoff: Object.freeze({ room: 'room-0' }),
		rotate: () => Object.freeze({ room: 'unexpected' }),
	});
	await assert.rejects(rotate('hosted'), /unknown pairing exposure mode/u);
});

test('pairing operation queue waits for room refresh before starting approval work', async () => {
	const queue = createPairingOperationQueue();
	const order = [];
	let finishRefresh;
	let refreshStarted;
	const refreshHasStarted = new Promise((resolve) => {
		refreshStarted = resolve;
	});
	const refreshGate = new Promise((resolve) => {
		finishRefresh = resolve;
	});
	const refresh = queue.run(async () => {
		order.push('refresh-started');
		refreshStarted();
		await refreshGate;
		order.push('refresh-finished');
	});
	await refreshHasStarted;
	const approval = queue.run(async () => {
		order.push('approval-started');
	});
	await Promise.resolve();
	assert.deepEqual(order, ['refresh-started']);
	finishRefresh();
	await Promise.all([refresh, approval]);
	assert.deepEqual(order, [
		'refresh-started',
		'refresh-finished',
		'approval-started',
	]);
});
