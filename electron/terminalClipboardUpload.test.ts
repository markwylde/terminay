import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
	clipboardUriListFilePaths,
	MAX_TERMINAL_CLIPBOARD_FILE_PART_BYTES,
	TerminalClipboardUploadReader,
} from './terminalClipboardUpload.ts';

const sources = (uriList: string | null, text = '', png: Uint8Array | null = null) => ({
	readUriList: async () => uriList,
	readText: () => text,
	readPng: async () => png,
});

test('only a uri-list of local file URLs names copied files', () => {
	assert.deepEqual(clipboardUriListFilePaths('file:///tmp/a%20b.png\r\n'), ['/tmp/a b.png']);
	assert.equal(clipboardUriListFilePaths('https://example.com/a.png'), null);
	assert.equal(clipboardUriListFilePaths('file:///tmp/a.png\nhttps://example.com'), null);
	assert.equal(clipboardUriListFilePaths('# comment\n'), null);
});

test('copied files are named, not pathed, and read back only by the latest token', async (t) => {
	const dir = await mkdtemp(path.join(tmpdir(), 'terminay-clipboard-upload-'));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const file = path.join(dir, 'CleanShot 2x.png');
	await writeFile(file, Buffer.from('abcdef'));
	const reader = new TerminalClipboardUploadReader();

	const result = await reader.read(sources(pathToFileURL(file).href));
	assert.equal(result.kind, 'files');
	if (result.kind !== 'files') return;
	assert.deepEqual(result.files, [{ name: 'CleanShot 2x.png', size: 6 }]);
	assert.equal(JSON.stringify(result).includes(dir), false, 'no local path crosses to the renderer');

	assert.deepEqual([...(await reader.readPart(result.token, 0, 2, 3))], [...Buffer.from('cde')]);
	await assert.rejects(reader.readPart('other', 0, 0, 1));
	await assert.rejects(reader.readPart(result.token, 1, 0, 1));
	await assert.rejects(reader.readPart(result.token, 0, 0, MAX_TERMINAL_CLIPBOARD_FILE_PART_BYTES + 1));

	await reader.read(sources(null, 'hello'));
	await assert.rejects(reader.readPart(result.token, 0, 0, 1), 'a later read retires the earlier files');
});

test('a copied folder is reported, text wins over an image, and an image is returned as bytes', async (t) => {
	const dir = await mkdtemp(path.join(tmpdir(), 'terminay-clipboard-upload-'));
	t.after(() => rm(dir, { recursive: true, force: true }));
	await mkdir(path.join(dir, 'folder'));
	const reader = new TerminalClipboardUploadReader();
	assert.deepEqual(await reader.read(sources(pathToFileURL(path.join(dir, 'folder')).href)), { kind: 'folder' });
	assert.deepEqual(await reader.read(sources(null, 'text', new Uint8Array([1]))), { kind: 'text', text: 'text' });
	assert.deepEqual(await reader.read(sources(null, '', new Uint8Array([1]))), {
		kind: 'image',
		bytes: new Uint8Array([1]),
		mimeType: 'image/png',
	});
	assert.deepEqual(await reader.read(sources(null)), { kind: 'empty' });
});
