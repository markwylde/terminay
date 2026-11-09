import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const out = await mkdtemp(join(tmpdir(), 'terminay-folder-presentation-'));
await build({
	entryPoints: ['electron/nativeFolderPresentation.ts'],
	platform: 'node',
	format: 'esm',
	outfile: join(out, 'presentation.mjs'),
});
const { presentLocalFolderLaunch } = await import(
	pathToFileURL(join(out, 'presentation.mjs')).href
);
test.after(() => rm(out, { recursive: true, force: true }));
function window(id) {
	const events = new EventEmitter();
	const calls = [];
	return Object.assign(events, {
		webContents: { id },
		calls,
		isDestroyed: () => false,
		isMinimized: () => true,
		restore: () => calls.push('restore'),
		show: () => calls.push('show'),
		focus: () => calls.push('focus'),
	});
}
test('a focused remote or auxiliary window never receives a local folder launch', async () => {
	const remote = window(1),
		auxiliary = window(2),
		local = window(3);
	let creates = 0;
	await presentLocalFolderLaunch({
		localProfileId: 'local',
		viewId: 'view',
		candidates: [
			{ window: remote, profileId: 'remote', viewId: 'view', auxiliary: false },
			{
				window: auxiliary,
				profileId: 'local',
				viewId: 'view',
				auxiliary: true,
			},
		],
		createLocalWindow: (view) => {
			assert.equal(view, 'view');
			creates++;
			return local;
		},
		present: async (owner) => assert.equal(owner, 3),
	});
	assert.equal(creates, 1);
	assert.deepEqual(remote.calls, []);
	assert.deepEqual(auxiliary.calls, []);
	assert.deepEqual(local.calls, ['restore', 'show', 'focus']);
});
test('the existing local window for the project view is reused', async () => {
	const local = window(3);
	await presentLocalFolderLaunch({
		localProfileId: 'local',
		viewId: 'view',
		candidates: [
			{ window: local, profileId: 'local', viewId: 'view', auxiliary: false },
		],
		createLocalWindow: () => {
			throw Error('must reuse');
		},
		present: async (owner) => assert.equal(owner, 3),
	});
	assert.deepEqual(local.calls, ['restore', 'show', 'focus']);
});
test('closing a window cancels presentation without touching terminal lifecycle', async () => {
	const local = window(3);
	const pending = presentLocalFolderLaunch({
		localProfileId: 'local',
		viewId: 'view',
		candidates: [],
		createLocalWindow: () => local,
		present: async (_, signal) =>
			new Promise((_, reject) => {
				signal.addEventListener('abort', () => reject(Error('closed')), {
					once: true,
				});
			}),
	});
	local.emit('closed');
	await assert.rejects(pending, /closed/);
	assert.deepEqual(local.calls, []);
	assert.equal(local.listenerCount('closed'), 0);
});
test('a stalled addressed client times out and releases presentation', async () => {
	const local = window(3);
	await assert.rejects(
		presentLocalFolderLaunch({
			localProfileId: 'local',
			viewId: 'view',
			candidates: [],
			createLocalWindow: () => local,
			timeoutMs: 5,
			present: async (_, signal) =>
				new Promise((_, reject) =>
					signal.addEventListener('abort', () => reject(Error('timed out')), {
						once: true,
					}),
				),
		}),
		/timed out/,
	);
	assert.equal(local.listenerCount('closed'), 0);
	assert.deepEqual(local.calls, []);
});
