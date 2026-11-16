import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	HOST_FILE_SAVE_BUSY,
	HOST_FILE_SAVE_CHUNK_MAX_BYTES,
	HOST_FILE_SAVE_ENDED,
	HOST_FILE_SAVE_FAILED,
	HostFileSaves,
	type HostFileSaveFs,
} from './hostFileSaves.ts';

async function tempDir(t: test.TestContext): Promise<string> {
	const dir = await mkdtemp(path.join(tmpdir(), 'terminay-host-save-'));
	t.after(() => rm(dir, { recursive: true, force: true }));
	return dir;
}

const pick = (filePath: string) => async () => ({ canceled: false, filePath });
const bytes = (text: string) => new TextEncoder().encode(text);

function noPath(error: unknown, dir: string): boolean {
	return error instanceof Error && !error.message.includes(dir) && !error.message.includes('/');
}

test('a save lands whole at the chosen destination, and only on commit', async (t) => {
	const dir = await tempDir(t);
	const destination = path.join(dir, 'notes.txt');
	let suggested = '';
	const saves = new HostFileSaves({
		showSaveDialog: async (name) => {
			suggested = name;
			return { canceled: false, filePath: destination };
		},
	});
	const opened = await saves.open('notes.txt');
	assert.equal(suggested, 'notes.txt');
	assert.equal(opened.canceled, false);
	if (opened.canceled) return;
	assert.equal(opened.token.length, 32);
	await saves.write(opened.token, bytes('hello '));
	await saves.write(opened.token, bytes('world'));
	assert.deepEqual(
		(await readdir(dir)).filter((name) => name === 'notes.txt'),
		[],
		'nothing at the destination before commit',
	);
	assert.deepEqual(await saves.close(opened.token, true), { saved: true });
	assert.equal(await readFile(destination, 'utf8'), 'hello world');
	assert.deepEqual(await readdir(dir), ['notes.txt']);
	await assert.rejects(saves.write(opened.token, bytes('x')), { message: HOST_FILE_SAVE_ENDED });
});

test('an empty file is saved with no writes', async (t) => {
	const dir = await tempDir(t);
	const destination = path.join(dir, '.env');
	const saves = new HostFileSaves({ showSaveDialog: pick(destination) });
	const opened = await saves.open('.env');
	assert.ok(!opened.canceled);
	await saves.close(opened.token, true);
	assert.equal(await readFile(destination, 'utf8'), '');
});

test('a cancelled dialog writes nothing', async (t) => {
	const dir = await tempDir(t);
	const saves = new HostFileSaves({ showSaveDialog: async () => ({ canceled: true }) });
	assert.deepEqual(await saves.open('a.txt'), { canceled: true });
	assert.deepEqual(await readdir(dir), []);
	assert.equal(saves.openCount, 0);
});

test('an abandoned save leaves nothing and an existing file untouched', async (t) => {
	const dir = await tempDir(t);
	const destination = path.join(dir, 'keep.txt');
	await writeFile(destination, 'original');
	const saves = new HostFileSaves({ showSaveDialog: pick(destination) });
	const opened = await saves.open('keep.txt');
	assert.ok(!opened.canceled);
	await saves.write(opened.token, bytes('new'));
	assert.deepEqual(await saves.close(opened.token, false), { saved: false });
	assert.equal(await readFile(destination, 'utf8'), 'original');
	assert.deepEqual(await readdir(dir), ['keep.txt']);
	await assert.rejects(saves.close(opened.token, true), { message: HOST_FILE_SAVE_ENDED });
});

test('a confirmed replacement holds the new bytes', async (t) => {
	const dir = await tempDir(t);
	const destination = path.join(dir, 'keep.txt');
	await writeFile(destination, 'original');
	const saves = new HostFileSaves({ showSaveDialog: pick(destination) });
	const opened = await saves.open('keep.txt');
	assert.ok(!opened.canceled);
	await saves.write(opened.token, bytes('new'));
	await saves.close(opened.token, true);
	assert.equal(await readFile(destination, 'utf8'), 'new');
});

test('write and move failures end the save, name no path, and keep the original', async (t) => {
	const dir = await tempDir(t);
	const destination = path.join(dir, 'keep.txt');
	await writeFile(destination, 'original');
	const real: HostFileSaveFs = {
		open: async (target) => (await import('node:fs/promises')).open(target, 'wx'),
		rename: async (from, to) => (await import('node:fs/promises')).rename(from, to),
		remove: (target) => rm(target, { force: true }),
	};
	const failingWrite: HostFileSaveFs = {
		...real,
		open: async (target) => {
			const handle = await real.open(target);
			return {
				close: () => handle.close(),
				write: async () => {
					throw new Error(`EIO: ${target}`);
				},
			} as unknown as Awaited<ReturnType<HostFileSaveFs['open']>>;
		},
	};
	const writes = new HostFileSaves({ showSaveDialog: pick(destination), fs: failingWrite });
	const first = await writes.open('keep.txt');
	assert.ok(!first.canceled);
	await assert.rejects(writes.write(first.token, bytes('x')), (error) => {
		assert.equal((error as Error).message, HOST_FILE_SAVE_FAILED);
		return noPath(error, dir);
	});
	await assert.rejects(writes.close(first.token, true), { message: HOST_FILE_SAVE_ENDED });
	assert.deepEqual(await readdir(dir), ['keep.txt']);

	const failingRename: HostFileSaveFs = {
		...real,
		rename: async (from) => {
			throw new Error(`EXDEV: ${from}`);
		},
	};
	const renames = new HostFileSaves({ showSaveDialog: pick(destination), fs: failingRename });
	const second = await renames.open('keep.txt');
	assert.ok(!second.canceled);
	await renames.write(second.token, bytes('new'));
	await assert.rejects(renames.close(second.token, true), (error) => {
		assert.equal((error as Error).message, HOST_FILE_SAVE_FAILED);
		return noPath(error, dir);
	});
	assert.equal(await readFile(destination, 'utf8'), 'original');
	assert.deepEqual(await readdir(dir), ['keep.txt']);
});

test('a missing destination directory fails without a path', async (t) => {
	const dir = await tempDir(t);
	const saves = new HostFileSaves({ showSaveDialog: pick(path.join(dir, 'gone', 'a.txt')) });
	await assert.rejects(saves.open('a.txt'), (error) => {
		assert.equal((error as Error).message, HOST_FILE_SAVE_FAILED);
		return noPath(error, dir);
	});
	assert.equal(saves.openCount, 0);
});

test('unknown tokens, oversized chunks and overlapping writes are refused', async (t) => {
	const dir = await tempDir(t);
	const saves = new HostFileSaves({ showSaveDialog: pick(path.join(dir, 'a.bin')) });
	await assert.rejects(saves.write('B'.repeat(32), bytes('x')), { message: HOST_FILE_SAVE_ENDED });
	const opened = await saves.open('a.bin');
	assert.ok(!opened.canceled);
	await assert.rejects(
		saves.write(opened.token, new Uint8Array(HOST_FILE_SAVE_CHUNK_MAX_BYTES + 1)),
		{ message: HOST_FILE_SAVE_FAILED },
	);
	const pending = saves.write(opened.token, new Uint8Array(HOST_FILE_SAVE_CHUNK_MAX_BYTES));
	await assert.rejects(saves.write(opened.token, bytes('x')), { message: HOST_FILE_SAVE_FAILED });
	await pending;
	await saves.close(opened.token, true);
	assert.equal((await readFile(path.join(dir, 'a.bin'))).byteLength, HOST_FILE_SAVE_CHUNK_MAX_BYTES);
});

test('a token from another registry is refused', async (t) => {
	const dir = await tempDir(t);
	const mine = new HostFileSaves({ showSaveDialog: pick(path.join(dir, 'a.txt')) });
	const theirs = new HostFileSaves({ showSaveDialog: pick(path.join(dir, 'b.txt')) });
	const opened = await mine.open('a.txt');
	assert.ok(!opened.canceled);
	await assert.rejects(theirs.write(opened.token, bytes('x')), { message: HOST_FILE_SAVE_ENDED });
	await assert.rejects(theirs.close(opened.token, true), { message: HOST_FILE_SAVE_ENDED });
	await mine.write(opened.token, bytes('ok'));
	await mine.close(opened.token, true);
	assert.equal(await readFile(path.join(dir, 'a.txt'), 'utf8'), 'ok');
});

test('at most four saves are open, counting a dialog still showing', async (t) => {
	const dir = await tempDir(t);
	let release: (() => void) | undefined;
	let n = 0;
	const saves = new HostFileSaves({
		showSaveDialog: async () => {
			n += 1;
			if (n === 4) await new Promise<void>((resolve) => (release = resolve));
			return { canceled: false, filePath: path.join(dir, `f${n}`) };
		},
	});
	for (let i = 0; i < 3; i += 1) assert.ok(!(await saves.open('f')).canceled);
	const fourth = saves.open('f');
	await new Promise((resolve) => setImmediate(resolve));
	await assert.rejects(saves.open('f'), { message: HOST_FILE_SAVE_BUSY });
	assert.equal(n, 4, 'no dialog shown for the refused save');
	release?.();
	assert.ok(!(await fourth).canceled);
	await saves.dispose();
	assert.deepEqual(await readdir(dir), []);
});

test('an idle save expires and leaves nothing', async (t) => {
	const dir = await tempDir(t);
	const timers: Array<() => void> = [];
	const saves = new HostFileSaves({
		showSaveDialog: pick(path.join(dir, 'a.txt')),
		setTimer: (callback) => {
			timers.push(callback);
			return timers.length;
		},
		clearTimer: () => undefined,
	});
	const opened = await saves.open('a.txt');
	assert.ok(!opened.canceled);
	await saves.write(opened.token, bytes('x'));
	timers.at(-1)?.();
	await assert.rejects(saves.close(opened.token, true), { message: HOST_FILE_SAVE_ENDED });
	for (let i = 0; i < 50 && (await readdir(dir)).length > 0; i += 1)
		await new Promise((resolve) => setTimeout(resolve, 10));
	assert.deepEqual(await readdir(dir), []);
});

test('disposing ends open saves and discards a dialog that resolves later', async (t) => {
	const dir = await tempDir(t);
	let release: (() => void) | undefined;
	let first = true;
	const saves = new HostFileSaves({
		showSaveDialog: async () => {
			if (first) {
				first = false;
				return { canceled: false, filePath: path.join(dir, 'open.txt') };
			}
			await new Promise<void>((resolve) => (release = resolve));
			return { canceled: false, filePath: path.join(dir, 'late.txt') };
		},
	});
	const opened = await saves.open('open.txt');
	assert.ok(!opened.canceled);
	await saves.write(opened.token, bytes('x'));
	const late = saves.open('late.txt');
	await new Promise((resolve) => setImmediate(resolve));
	await saves.dispose();
	release?.();
	await assert.rejects(late, { message: HOST_FILE_SAVE_ENDED });
	await assert.rejects(saves.open('again.txt'), { message: HOST_FILE_SAVE_ENDED });
	await assert.rejects(saves.close(opened.token, true), { message: HOST_FILE_SAVE_ENDED });
	assert.deepEqual(await readdir(dir), []);
});
