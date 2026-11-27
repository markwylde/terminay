import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
	desktopTabs,
	desktopTabsIn,
	parseDesktopTabs,
	resetDesktopTabsForTest,
} from './desktopTabs.ts';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
	configurable: true,
	value: {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => void storage.set(key, value),
	},
});

beforeEach(() => {
	storage.clear();
	resetDesktopTabsForTest();
});

const place = { projectId: 'p1', folderId: 'f1' };

test('what a device remembers is read back only where it is whole', () => {
	assert.deepEqual(parseDesktopTabs('nope'), []);
	assert.deepEqual(
		parseDesktopTabs([
			{ id: 'a', serverId: 's', place },
			{ id: 'a', serverId: 's', place },
			{ id: 'b', serverId: 's', place: { projectId: 'p1' } },
			{ id: '', serverId: 's', place },
			null,
		]),
		[{ id: 'a', serverId: 's', place }],
	);
});

test('opening, moving and closing a tab is one entry, remembered across reloads', () => {
	let changes = 0;
	desktopTabs.subscribe(() => changes++);
	desktopTabs.add({ id: 't1', serverId: 's', place });
	desktopTabs.add({ id: 't2', serverId: 's', place });
	assert.equal(desktopTabsIn(desktopTabs.list(), 's', place).length, 2);
	// Another server's tabs are not this one's.
	assert.equal(desktopTabsIn(desktopTabs.list(), 'other', place).length, 0);

	const elsewhere = { projectId: 'p2', folderId: 'f9' };
	desktopTabs.move('t1', elsewhere);
	assert.deepEqual(desktopTabs.placeOf('t1'), elsewhere);
	assert.deepEqual(
		desktopTabsIn(desktopTabs.list(), 's', place).map((e) => e.id),
		['t2'],
	);

	resetDesktopTabsForTest();
	assert.deepEqual(desktopTabs.placeOf('t1'), elsewhere);
	desktopTabs.remove('t1');
	desktopTabs.remove('missing');
	assert.deepEqual(
		desktopTabs.list().map((e) => e.id),
		['t2'],
	);
	assert.equal(changes, 3);
});
