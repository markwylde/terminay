import assert from 'node:assert/strict';
import test from 'node:test';
import { FileSession } from '../../../packages/server-core/dist/index.js';
import {
	DocumentationAutosaveController,
	type DocumentationAutosaveSession,
	type DocumentationAutosaveState,
} from './DocumentationAutosaveController.ts';

class FakeTimers {
	private nextId = 1;
	private nowMs = 0;
	private readonly pending = new Map<number, { due: number; callback: () => void }>();

	readonly setTimeoutFn = (callback: () => void, ms: number): number => {
		const id = this.nextId++;
		this.pending.set(id, { due: this.nowMs + ms, callback });
		return id;
	};

	readonly clearTimeoutFn = (id: number): void => {
		this.pending.delete(id);
	};

	tick(ms: number): void {
		this.nowMs += ms;
		for (const [id, timer] of [...this.pending]) {
			if (timer.due > this.nowMs) continue;
			this.pending.delete(id);
			timer.callback();
		}
	}
}
async function settle(): Promise<void> {
	for (let index = 0; index < 10; index += 1) await Promise.resolve();
}


function session(
	edit: DocumentationAutosaveSession['edit'],
	save: DocumentationAutosaveSession['save'] = async (draft, disk) => ({
		draftRevision: draft,
		diskRevision: disk + 1,
	}),
): DocumentationAutosaveSession {
	return { edit, save };
}

test('autosave stores the newest text, ignores initial normalization, and debounce-resets', async () => {
	const timers = new FakeTimers();
	const edits: string[] = [];
	const states: DocumentationAutosaveState[] = [];
	const controller = new DocumentationAutosaveController(
		session(async (text, draft) => {
			edits.push(text);
			return { draftRevision: draft + 1, diskRevision: 1 };
		}),
		(state) => states.push(state),
		0,
		1,
		timers,
	);
	controller.changed('# Hello', true);
	assert.deepEqual(states, []);
	controller.changed('# Hello 1');
	controller.changed('# Hello 12');
	timers.tick(999);
	assert.deepEqual(edits, []);
	timers.tick(1);
	await settle();
	assert.deepEqual(edits, ['# Hello 12']);
	controller.dispose();
});

test('autosave calls edit then save with the returned draft and current disk revision', async () => {
	const calls: string[] = [];
	const controller = new DocumentationAutosaveController(
		{
			async edit(text, expectedDraftRevision) {
				calls.push(`edit:${text}:${expectedDraftRevision}`);
				return { draftRevision: expectedDraftRevision + 1, diskRevision: 4 };
			},
			async save(expectedDraftRevision, expectedDiskRevision) {
				calls.push(`save:${expectedDraftRevision}:${expectedDiskRevision}`);
				return { draftRevision: expectedDraftRevision, diskRevision: expectedDiskRevision + 1 };
			},
		},
		() => {},
		2,
		4,
		{ delayMs: 0, setTimeoutFn: (callback) => (callback(), 1), clearTimeoutFn() {} },
	);
	controller.changed('next');
	await Promise.resolve();
	await Promise.resolve();
	assert.deepEqual(calls, ['edit:next:2', 'save:3:4']);
	controller.dispose();
});

test('one pipeline runs at a time and a newer pending text saves immediately after', async () => {
	const timers = new FakeTimers();
	let release!: () => void;
	const edits: string[] = [];
	const states: DocumentationAutosaveState[] = [];
	const controller = new DocumentationAutosaveController(
		session(async (text, draft) => {
			edits.push(text);
			if (edits.length === 1) await new Promise<void>((resolve) => { release = resolve; });
			return { draftRevision: draft + 1, diskRevision: 1 };
		}),
		(state) => states.push(state),
		0,
		1,
		timers,
	);
	controller.changed('one');
	timers.tick(1000);
	await Promise.resolve();
	controller.changed('two');
	assert.equal(edits.length, 1);
	release();
	await settle();
	assert.deepEqual(edits, ['one', 'two']);
	assert.equal(states.includes('dirty'), true);
	controller.dispose();
});

test('an older completion never marks a newer draft saved', async () => {
	const states: DocumentationAutosaveState[] = [];
	let finishFirst!: (value: { draftRevision: number; diskRevision: number }) => void;
	const controller = new DocumentationAutosaveController(
		{
			async edit(_text, draft) {
				if (finishFirst === undefined) {
					return new Promise((resolve) => {
						finishFirst = resolve;
					});
				}
				return { draftRevision: draft + 1, diskRevision: 1 };
			},
			async save(draft, disk) {
				return { draftRevision: draft, diskRevision: disk + 1 };
			},
		},
		(state) => states.push(state),
		0,
		1,
		{ delayMs: 0, setTimeoutFn: (callback) => (callback(), 1), clearTimeoutFn() {} },
	);
	controller.changed('old');
	await Promise.resolve();
	controller.changed('new');
	finishFirst({ draftRevision: 1, diskRevision: 1 });
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(states.at(-1) === 'saved', false);
	controller.dispose();
});

test('conflict stops automatic saving until the user resolves it', async () => {
	const timers = new FakeTimers();
	let calls = 0;
	const states: DocumentationAutosaveState[] = [];
	const controller = new DocumentationAutosaveController(
		session(async () => {
			calls += 1;
			throw new Error('disk revision is stale');
		}),
		(state) => states.push(state),
		0,
		1,
		timers,
	);
	controller.changed('dirty');
	timers.tick(1000);
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(states.at(-1), 'conflict');
	controller.changed('again');
	timers.tick(1000);
	await Promise.resolve();
	assert.equal(calls, 1);
	controller.resolveConflict('keep-local');
	timers.tick(1000);
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(calls, 2);
	controller.dispose();
});

test('unmount cancels timers without closing the shared file session', async () => {
	const timers = new FakeTimers();
	let saved = false;
	const controller = new DocumentationAutosaveController(
		session(async (text, draft) => {
			saved = true;
			return { draftRevision: draft + 1, diskRevision: 1 };
		}),
		() => {},
		0,
		1,
		timers,
	);
	controller.changed('pending');
	controller.dispose();
	timers.tick(1000);
	assert.equal(saved, false);
});

test('autosave uses the real file-session edit and save operations', async () => {
	const files = new Map<string, Uint8Array>([
		['/project/README.md', new TextEncoder().encode('# Hello')],
	]);
	const fileSession = await FileSession.open('/project/README.md', {
		async atomicWrite(path, bytes) {
			files.set(path, bytes);
		},
		async readFile(path) {
			return files.get(path) ?? new Uint8Array();
		},
		async stat() {
			return { isFile: true, size: files.get('/project/README.md')?.byteLength ?? 0 };
		},
	}, { loadInitialBytes: true });
	const controller = new DocumentationAutosaveController(
		{
			async edit(text, expectedDraftRevision) {
				const result = fileSession.edit(new TextEncoder().encode(text), expectedDraftRevision);
				if (!result.ok) throw result.error;
				return { draftRevision: result.value.draftRevision, diskRevision: result.value.diskRevision };
			},
			async save(expectedDraftRevision, expectedDiskRevision) {
				const result = await fileSession.save({
					expectedDraftRevision,
					expectedDiskRevision,
				});
				if (!result.ok) throw result.error;
				return { draftRevision: result.value.draftRevision, diskRevision: result.value.diskRevision };
			},
		},
		() => {},
		fileSession.draftRevision,
		fileSession.diskRevision,
		{ delayMs: 0, setTimeoutFn: (callback) => (callback(), 1), clearTimeoutFn() {} },
	);
	controller.changed('# Hello world');
	assert.equal(await controller.flush(), true);
	assert.equal(new TextDecoder().decode(files.get('/project/README.md')), '# Hello world');
	assert.equal(fileSession.dirty, false);
	controller.dispose();
});
