import assert from 'node:assert/strict';
import test from 'node:test';
import { readRememberedGeometry, writeRememberedGeometry } from './geometryStore.ts';

const KEY = 'terminay.view.in-page-window.v1';

function withStorage(storage: unknown, run: () => void): void {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
	try {
		run();
	} finally {
		if (previous === undefined) Reflect.deleteProperty(globalThis, 'localStorage');
		else Object.defineProperty(globalThis, 'localStorage', previous);
	}
}

function memoryStorage(initial: Record<string, string> = {}) {
	const items = new Map(Object.entries(initial));
	return {
		items,
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => void items.set(key, value),
	};
}

test('geometry round-trips per window', () => {
	withStorage(memoryStorage(), () => {
		writeRememberedGeometry('settings', { x: 10.4, y: 20, width: 900, height: 600, maximized: false });
		writeRememberedGeometry('macros', { x: 1, y: 2, width: 500, height: 400, maximized: true });
		assert.deepEqual(readRememberedGeometry('settings'), { x: 10, y: 20, width: 900, height: 600, maximized: false });
		assert.deepEqual(readRememberedGeometry('macros'), { x: 1, y: 2, width: 500, height: 400, maximized: true });
		assert.equal(readRememberedGeometry('recordings'), null);
	});
});

test('malformed storage means no remembered geometry', () => {
	for (const raw of ['{not json', '[]', '"text"', 'null']) {
		withStorage(memoryStorage({ [KEY]: raw }), () => {
			assert.equal(readRememberedGeometry('settings'), null);
		});
	}
});

test('an entry with a field that is not a finite number or a boolean is ignored', () => {
	const bad = [
		{ x: 'a', y: 0, width: 500, height: 400, maximized: false },
		{ x: 0, y: null, width: 500, height: 400, maximized: false },
		{ x: 0, y: 0, width: 0, height: 400, maximized: false },
		{ x: 0, y: 0, width: 500, height: 400, maximized: 'yes' },
		{ x: 0, y: 0, width: 500, height: 400 },
	];
	for (const entry of bad) {
		withStorage(memoryStorage({ [KEY]: JSON.stringify({ settings: entry }) }), () => {
			assert.equal(readRememberedGeometry('settings'), null);
		});
	}
	// JSON cannot carry Infinity; it arrives as null and is rejected the same way.
	withStorage(memoryStorage({ [KEY]: '{"settings":{"x":1e999,"y":0,"width":500,"height":400,"maximized":false}}' }), () => {
		assert.equal(readRememberedGeometry('settings'), null);
	});
});

test('an unknown window id is dropped and does not disturb the others', () => {
	const stored = { nope: { x: 0, y: 0, width: 500, height: 400, maximized: false }, settings: { x: 5, y: 6, width: 700, height: 500, maximized: false } };
	const storage = memoryStorage({ [KEY]: JSON.stringify(stored) });
	withStorage(storage, () => {
		assert.deepEqual(readRememberedGeometry('settings'), stored.settings);
		writeRememberedGeometry('macros', { x: 1, y: 2, width: 500, height: 400, maximized: false });
		assert.deepEqual(Object.keys(JSON.parse(storage.items.get(KEY) ?? '{}')).sort(), ['macros', 'settings']);
	});
});

test('storage that throws or is missing is not an error', () => {
	const throwing = {
		getItem: () => {
			throw new Error('denied');
		},
		setItem: () => {
			throw new Error('denied');
		},
	};
	for (const storage of [throwing, undefined]) {
		withStorage(storage, () => {
			assert.equal(readRememberedGeometry('settings'), null);
			assert.doesNotThrow(() => writeRememberedGeometry('settings', { x: 0, y: 0, width: 500, height: 400, maximized: false }));
		});
	}
});
