import assert from 'node:assert/strict';
import test from 'node:test';
import { PreviewStorageBroker } from './PreviewStorageBroker.ts';

class MemoryStorage {
	readonly values = new Map<string, string>();
	getItem(key: string): string | null { return this.values.get(key) ?? null; }
	setItem(key: string, value: string): void { this.values.set(key, value); }
	removeItem(key: string): void { this.values.delete(key); }
	clear(): void { this.values.clear(); }
	key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
	get length(): number { return this.values.size; }
}

test('preview storage is scoped by canonical project key and validates mutations', () => {
	const store = new MemoryStorage();
	const broker = new PreviewStorageBroker(store as unknown as Storage);
	broker.persist('server-a:project-a', { cookie: 'color=blue', entries: { theme: 'dark', invalid: 4 } });
	assert.deepEqual(broker.snapshot('server-a:project-a'), { cookie: 'color=blue', entries: { theme: 'dark' } });
	assert.deepEqual(broker.snapshot('server-a:project-b'), { cookie: '', entries: {} });
});
