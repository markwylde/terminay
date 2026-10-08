import assert from 'node:assert/strict';
import test from 'node:test';
import { closeTopOnEscape, createWindowStack } from './windowStack.ts';

const escapeKey = () => {
	const event = {
		key: 'Escape',
		defaultPrevented: false,
		preventDefault() {
			event.defaultPrevented = true;
		},
	};
	return event;
};

test('one Escape closes only the topmost window, in reverse order of opening', () => {
	const stack = createWindowStack();
	const closed: string[] = [];
	const removers = new Map<string, () => void>();
	for (const name of ['remote-control', 'pairing']) {
		const entry = {
			close: () => {
				closed.push(name);
				removers.get(name)?.();
			},
		};
		removers.set(name, stack.push(entry));
	}
	assert.equal(closeTopOnEscape(stack, escapeKey()), true);
	assert.deepEqual(closed, ['pairing']);
	assert.equal(closeTopOnEscape(stack, escapeKey()), true);
	assert.deepEqual(closed, ['pairing', 'remote-control']);
	assert.equal(closeTopOnEscape(stack, escapeKey()), false);
});

test('depth follows opening order and closes up when a window leaves', () => {
	const stack = createWindowStack();
	const lower = { close() {} };
	const upper = { close() {} };
	const removeLower = stack.push(lower);
	stack.push(upper);
	assert.equal(stack.depthOf(lower), 0);
	assert.equal(stack.depthOf(upper), 1);
	removeLower();
	assert.equal(stack.depthOf(lower), -1);
	assert.equal(stack.depthOf(upper), 0);
});

test('a key something inside the window already handled does not close it', () => {
	const stack = createWindowStack();
	let closed = 0;
	stack.push({
		close: () => {
			closed += 1;
		},
	});
	const handled = escapeKey();
	handled.preventDefault();
	assert.equal(closeTopOnEscape(stack, handled), false);
	assert.equal(closeTopOnEscape(stack, { ...escapeKey(), key: 'Enter' }), false);
	assert.equal(closed, 0);
});

test('subscribers hear every change', () => {
	const stack = createWindowStack();
	let calls = 0;
	const unsubscribe = stack.subscribe(() => {
		calls += 1;
	});
	const remove = stack.push({ close() {} });
	remove();
	unsubscribe();
	stack.push({ close() {} });
	assert.equal(calls, 2);
});
