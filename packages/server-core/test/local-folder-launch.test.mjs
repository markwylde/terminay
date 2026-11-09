import assert from 'node:assert/strict';
import test from 'node:test';
import {
	mkdtemp,
	mkdir,
	realpath,
	rm,
	stat,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceStore, createInitialWorkspace } from '../dist/index.js';
import { openLocalFolder } from '../dist/localFolderLaunch.js';

test('native folders canonicalize, reuse exact roots, and create a new terminal for each launch', async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-local-launch-'));
	try {
		const folder = join(root, 'ü space $(false)');
		await mkdir(folder);
		const alias = join(root, 'alias');
		await symlink(folder, alias, 'dir');
		const store = new WorkspaceStore(createInitialWorkspace('local'));
		const calls = [];
		const options = {
			canonicalDirectory: async (folder) => {
				const p = await realpath(folder);
				if (!(await stat(p)).isDirectory()) throw Error('not directory');
				return p;
			},
			state: () => store.state,
			defaultViewId: store.state.viewOrder[0],
			apply: (command) => {
				const result = store.apply({ commandId: randomUUID(), command });
				if (!result.ok) throw Error(result.conflict.message);
			},
			createTerminal: async (projectId, cwd) => {
				calls.push({ projectId, cwd });
				return { id: randomUUID() };
			},
		};
		const first = await openLocalFolder({ ...options, folder });
		const second = await openLocalFolder({ ...options, folder: alias });
		assert.equal(first.projectId, second.projectId);
		assert.notEqual(first.sessionId, second.sessionId);
		assert.deepEqual(
			calls.map((c) => c.cwd),
			[await realpath(folder), await realpath(folder)],
		);
		const before = store.state.revision;
		await assert.rejects(
			openLocalFolder({ ...options, folder: join(root, 'missing') }),
		);
		const file = join(root, 'file');
		await writeFile(file, 'x');
		await assert.rejects(
			openLocalFolder({ ...options, folder: file }),
			/not directory/,
		);
		assert.equal(store.state.revision, before);
		assert.equal(calls.length, 2);
		const failed = join(root, 'failed');
		await mkdir(failed);
		await assert.rejects(
			openLocalFolder({
				...options,
				folder: failed,
				createTerminal: async () => {
					throw Error('spawn failed');
				},
			}),
			/spawn failed/,
		);
		const canonicalFailed = await realpath(failed);
		assert.ok(
			Object.values(store.state.projects).some(
				(p) => p.root === canonicalFailed,
			),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('view readiness is bound to an exact connection and cancellation releases waiters', async () => {
	const { WorkspaceViewRelay } = await import('../dist/workspaceView/index.js');
	const relay = new WorkspaceViewRelay();
	const attach = relay.operations().commands['workspace-view.attach'];
	const controller = new AbortController();
	let ready = false;
	const pending = relay
		.waitForConnection('selected', controller.signal)
		.then((t) => {
			ready = true;
			return t;
		});
	await attach({
		context: { connectionId: 'other', clientId: 'other-client' },
		envelope: { payload: {} },
	});
	await Promise.resolve();
	assert.equal(ready, false);
	await attach({
		context: { connectionId: 'selected', clientId: 'selected-client' },
		envelope: { payload: {} },
	});
	assert.deepEqual(await pending, {
		connectionId: 'selected',
		clientId: 'selected-client',
	});
	const abort = new AbortController();
	const rejected = relay.waitForConnection('missing', abort.signal);
	abort.abort();
	await assert.rejects(rejected, /did not become ready/);
});

test('native startup waits for the selected workspace before publishing a project', async () => {
 const store=new WorkspaceStore(createInitialWorkspace('local'));
 let ready;const gate=new Promise(resolve=>{ready=resolve});const events=[];
 const opening=openLocalFolder({folder:'/new',canonicalDirectory:async folder=>folder,state:()=>store.state,defaultViewId:store.state.viewOrder[0],beforeCreate:async view=>{assert.equal(view,store.state.viewOrder[0]);events.push('waiting');await gate;events.push('ready')},apply:command=>{events.push('project');const result=store.apply({commandId:randomUUID(),command});assert.equal(result.ok,true)},createTerminal:async()=>{events.push('terminal');return{id:'session'}}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(events,['waiting']);assert.equal(store.state.revision,0);
 ready();await opening;assert.deepEqual(events,['waiting','ready','project','terminal']);
});
