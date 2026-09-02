import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('unsupported constructs stay editable through source mode and onError', async () => {
	const plugins = await readFile(
		new URL('./documentationEditorPlugins.tsx', import.meta.url),
		'utf8',
	);
	assert.match(plugins, /diffSourcePlugin\(\{ viewMode: 'rich-text' \}\)/);
	assert.match(plugins, /DiffSourceToggleWrapper/);
	const editor = await readFile(new URL('./DocumentationEditor.tsx', import.meta.url), 'utf8');
	assert.match(editor, /trim=\{false\}/);
	assert.match(editor, /onError=\{\(error\) => setMessage\(`Editor parser error: \$\{error\.error\}`\)\}/);
	const unsupported = `---
title: Keep
---

::unknown-directive{flag=1}

export const demo = 1;
`;
	assert.match(unsupported, /unknown-directive/);
	assert.match(editor, /Source mode/);
});
