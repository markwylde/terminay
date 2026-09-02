import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('MDXEditor plugins are configured once with the required first-party set', async () => {
	const source = await readFile(
		new URL('./documentationEditorPlugins.tsx', import.meta.url),
		'utf8',
	);
	for (const name of [
		'headingsPlugin',
		'listsPlugin',
		'quotePlugin',
		'thematicBreakPlugin',
		'linkPlugin',
		'imagePlugin',
		'tablePlugin',
		'codeBlockPlugin',
		'codeMirrorPlugin',
		'frontmatterPlugin',
		'directivesPlugin',
		'jsxPlugin',
		'markdownShortcutPlugin',
		'diffSourcePlugin',
		'toolbarPlugin',
	]) {
		assert.match(source, new RegExp(name, 'u'));
	}
	assert.match(source, /diffSourcePlugin\(\{ viewMode: 'rich-text' \}\)/);
	assert.match(source, /AdmonitionDirectiveDescriptor/);
	assert.match(source, /InsertAdmonition/);
	assert.doesNotMatch(source, /sandpackPlugin/);
	const editor = await readFile(new URL('./DocumentationEditor.tsx', import.meta.url), 'utf8');
	assert.match(editor, /documentationEditorPlugins/);
	assert.match(editor, /trim=\{false\}/);
	assert.match(editor, /onError=/);
});
