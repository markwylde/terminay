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
	const updated = await client.update<{
		cursorStyle: string;
		keyboardShortcuts: { 'new-terminal': string };
	}>({
		cursorStyle: 'underline',
		keyboardShortcuts: { 'new-terminal': 'CmdOrCtrl+Y' },
	});
	assert.equal(updated.cursorStyle, 'underline');
	assert.equal(updated.keyboardShortcuts['new-terminal'], 'CmdOrCtrl+Y');
	await client.reset();
	assert.deepEqual(calls, ['get', 'get', 'update', 'reset']);
	let observed: unknown;
	const unsubscribe = client.onChanged((value) => { observed = value; });
	for (const listener of listeners) listener({ settings: { cursorStyle: 'block' } });
	assert.equal((observed as { cursorStyle: string }).cursorStyle, 'block');
	unsubscribe();
	assert.equal(listeners.size, 0);
});

test('connection-host changes propagate between renderer windows', async () => {
	const storage = new Map<string, string>();
	const storageListeners = new Set<(event: { key: string | null; newValue: string | null }) => void>();
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
	Object.defineProperty(globalThis, 'window', { configurable: true, value: {
		addEventListener(type: string, listener: (event: { key: string | null; newValue: string | null }) => void) {
			if (type === 'storage') storageListeners.add(listener);
		},
		removeEventListener(type: string, listener: (event: { key: string | null; newValue: string | null }) => void) {
			if (type === 'storage') storageListeners.delete(listener);
		},
		localStorage: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => storage.set(key, value),
		},
	} });
	try {
		const rawClient = {
			async get() { return { revision: 1, settings: { scrollback: 5000 } }; },
			async update(value: unknown) { return { revision: 2, settings: value }; },
			async reset() { return { revision: 3, settings: {} }; },
			onChanged() { return () => undefined; },
		} as never;
		const workspace = createServerTerminalSettingsClient(rawClient);
		const settingsWindow = createServerTerminalSettingsClient(rawClient);
		await workspace.get();
		let observed: unknown;
		const stop = workspace.onChanged((value) => { observed = value; });
		await settingsWindow.update({ keyboardShortcuts: { 'new-terminal': 'CmdOrCtrl+Y' } });
		const [key, newValue] = [...storage.entries()][0] ?? [];
		for (const listener of storageListeners) listener({ key: key ?? null, newValue: newValue ?? null });
		await Promise.resolve();
		assert.equal(
			(observed as { keyboardShortcuts: { 'new-terminal': string } }).keyboardShortcuts['new-terminal'],
			'CmdOrCtrl+Y',
		);
		stop();
		assert.equal(storageListeners.size, 0);
	} finally {
		if (previousWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
		else Object.defineProperty(globalThis, 'window', previousWindow);
	}
});
