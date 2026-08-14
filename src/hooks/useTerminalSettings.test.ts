import assert from 'node:assert/strict';
import test from 'node:test';
import { createServerTerminalSettingsClient } from './useTerminalSettings.ts';

test('canonical settings client reads, writes, and observes only selected-server state', async () => {
	const listeners = new Set<(state: unknown) => void>();
	const calls: string[] = [];
	const client = createServerTerminalSettingsClient({
		async get() {
			calls.push('get');
			return { revision: 1, settings: { cursorStyle: 'bar' } };
		},
		async update(value: unknown) {
			calls.push('update');
			return { revision: 2, settings: value };
		},
		async reset() {
			calls.push('reset');
			return { revision: 3, settings: {} };
		},
		onChanged(listener: (state: unknown) => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	} as never);
	const initial = await client.get<{ cursorStyle: string }>();
	assert.equal(initial.cursorStyle, 'bar');
	await client.update({ cursorStyle: 'underline' });
	await client.reset();
	assert.deepEqual(calls, ['get', 'get', 'update', 'reset']);
	let observed: unknown;
	const unsubscribe = client.onChanged((value) => { observed = value; });
	for (const listener of listeners) listener({ settings: { cursorStyle: 'block' } });
	assert.equal((observed as { cursorStyle: string }).cursorStyle, 'block');
	unsubscribe();
	assert.equal(listeners.size, 0);
});
