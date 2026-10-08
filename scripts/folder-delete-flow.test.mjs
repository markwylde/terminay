import assert from 'node:assert/strict';
import test from 'node:test';
import {
	deleteFolderAndItsPanels,
	panelsHeldByFolder,
} from '../src/workspace/folderDeleteFlow.ts';

/**
 * A folder holding `panels`, with every step recorded. `keeps` are panels
 * whose close the user declines, as Keep Running does for a busy terminal.
 */
function folder(panels, { answer = 'cancel', keeps = [], refuses = [] } = {}) {
	const held = [...panels];
	const log = [];
	const steps = {
		panelIds: () => [...held],
		ask: async (count) => {
			log.push(`ask:${count}`);
			return answer;
		},
		movePanel: async (panelId) => {
			if (refuses.includes(panelId)) throw new Error(`refused ${panelId}`);
			log.push(`move:${panelId}`);
			held.splice(held.indexOf(panelId), 1);
		},
		closePanel: async (panelId) => {
			log.push(`close:${panelId}`);
			if (!keeps.includes(panelId)) held.splice(held.indexOf(panelId), 1);
		},
		remove: async () => {
			log.push('remove');
		},
	};
	return { held, log, steps };
}

test('an empty folder is deleted at once with no question', async () => {
	const empty = folder([]);
	assert.equal(await deleteFolderAndItsPanels(empty.steps), 'removed');
	assert.deepEqual(empty.log, ['remove']);
});

test('Move to General moves every panel, then deletes', async () => {
	const two = folder(['a', 'b'], { answer: 'move' });
	assert.equal(await deleteFolderAndItsPanels(two.steps), 'removed');
	assert.deepEqual(two.log, ['ask:2', 'move:a', 'move:b', 'remove']);
});

test('Close them closes every panel through the close path, then deletes', async () => {
	const two = folder(['a', 'b'], { answer: 'close' });
	assert.equal(await deleteFolderAndItsPanels(two.steps), 'removed');
	assert.deepEqual(two.log, ['ask:2', 'close:a', 'close:b', 'remove']);
});

test('a terminal kept running stays, and nothing is deleted', async () => {
	const busy = folder(['idle', 'busy'], { answer: 'close', keeps: ['busy'] });
	assert.equal(await deleteFolderAndItsPanels(busy.steps), 'panels-remain');
	assert.deepEqual(busy.log, ['ask:2', 'close:idle', 'close:busy']);
	assert.deepEqual(busy.held, ['busy']);
});

test('Cancel changes nothing', async () => {
	const two = folder(['a', 'b'], { answer: 'cancel' });
	assert.equal(await deleteFolderAndItsPanels(two.steps), 'cancelled');
	assert.deepEqual(two.log, ['ask:2']);
	assert.deepEqual(two.held, ['a', 'b']);
});

test('a refused move stops the flow with nothing deleted', async () => {
	const two = folder(['a', 'b'], { answer: 'move', refuses: ['a'] });
	await assert.rejects(() => deleteFolderAndItsPanels(two.steps), /refused a/);
	assert.deepEqual(two.log, ['ask:2']);
	assert.deepEqual(two.held, ['a', 'b']);
});

test('a panel that arrives after the question is not closed on the earlier answer', async () => {
	const one = folder(['a'], { answer: 'close' });
	const close = one.steps.closePanel;
	one.steps.closePanel = async (panelId) => {
		await close(panelId);
		// Another device opens a terminal in the folder meanwhile.
		one.held.push('late');
	};
	assert.equal(await deleteFolderAndItsPanels(one.steps), 'panels-remain');
	assert.deepEqual(one.log, ['ask:1', 'close:a']);
	assert.deepEqual(one.held, ['late']);
});

test('a panel that left while the question was open is not touched again', async () => {
	const two = folder(['a', 'b'], { answer: 'move' });
	const ask = two.steps.ask;
	two.steps.ask = async (count) => {
		two.held.splice(two.held.indexOf('a'), 1);
		return ask(count);
	};
	assert.equal(await deleteFolderAndItsPanels(two.steps), 'removed');
	assert.deepEqual(two.log, ['ask:2', 'move:b', 'remove']);
});

test('a folder holds the panels the server places in it and the ones opened on this device', () => {
	const folders = {
		general: { panelIds: ['p:1'] },
		feature: { panelIds: ['p:2', 'p:3'] },
	};
	const inventory = [
		{ panelId: 'p:1', folderId: 'general' },
		{ panelId: 'p:2', folderId: 'feature' },
		{ panelId: 'file-1', folderId: 'feature' },
		{ panelId: 'file-2', folderId: 'general' },
	];
	assert.deepEqual(panelsHeldByFolder('feature', folders, inventory), [
		{ panelId: 'p:2', isLocal: false },
		{ panelId: 'p:3', isLocal: false },
		{ panelId: 'file-1', isLocal: true },
	]);
	assert.deepEqual(panelsHeldByFolder('missing', folders, inventory), []);
});
