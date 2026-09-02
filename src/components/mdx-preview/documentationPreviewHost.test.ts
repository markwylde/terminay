import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { previewAcceptsFilesystemPath } from './previewRuntime.ts';

test('preview host accepts compiled bytes and opaque callbacks, never a host path', async () => {
	assert.equal(
		previewAcceptsFilesystemPath({ bundle: new Uint8Array(), fetchResource() {} }),
		false,
	);
	assert.equal(previewAcceptsFilesystemPath({ path: '/tmp/page.mdx' }), true);
	const editor = await readFile(
		new URL('../file-viewer/DocumentationEditor.tsx', import.meta.url),
		'utf8',
	);
	assert.match(editor, /<MdxPreview/);
	assert.match(editor, /bundle=\{compiled\.code\}/);
	assert.doesNotMatch(editor, /bundle=\{[^}]*path/);
	assert.match(editor, /kind === 'open-document'/);
	assert.match(editor, /kind === 'download'/);
	assert.match(editor, /kind === 'resize'/);
	assert.match(editor, /kind === 'diagnostic'/);
	assert.match(editor, /onExternalUrl/);
});
