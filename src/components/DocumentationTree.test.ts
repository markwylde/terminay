import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('folder rows only toggle and document rows open with accessible path context', async () => {
	const source = await readFile(new URL('./DocumentationTree.tsx', import.meta.url), 'utf8');
	assert.match(source, /onClick=\{\(\) => toggle\(childPath\)\}/);
	assert.match(source, /onClick=\{\(\) => open\(document\.relativePath\)\}/);
	assert.match(source, /documentTreeAccessibleName/);
	assert.match(source, /titleCase\(name\)/);
	assert.match(source, /aria-selected=\{document\.relativePath === selectedPath\}/);
	assert.match(source, /Showing a partial document catalog/);
	assert.doesNotMatch(source, /onClick=\{\(\) => open\(childPath\)\}/);
});
