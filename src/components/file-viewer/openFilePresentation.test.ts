import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('openFile finds the canonical panel by path and switches presentation', async () => {
	const source = await readFile(new URL('../../App.tsx', import.meta.url), 'utf8');
	assert.match(source, /filePathPanelMapRef\.current\.get\(filePath\)/);
	assert.match(source, /presentation: options\.presentation/);
	assert.match(source, /existingPanel\.api\.setActive\(\)/);
	assert.match(source, /presentation: 'documentation'/);
	assert.match(source, /terminay-documentation-open/);
});

test('Documentation links, Explorer opens, and external URLs take distinct paths', async () => {
	const editor = await readFile(new URL('./DocumentationEditor.tsx', import.meta.url), 'utf8');
	assert.match(editor, /onExternalUrl=\{\(url\) => \{\s*void openExternalUrl\(url\);/);
	assert.match(editor, /terminay-documentation-open/);
	assert.match(editor, /kind === 'open-document'/);
	const app = await readFile(new URL('../../App.tsx', import.meta.url), 'utf8');
	assert.match(app, /openFile\(path, \{ presentation: 'documentation' \}\)/);
});

test('normal text mode does not construct documentation autosave', async () => {
	const source = await readFile(new URL('./FilePanel.tsx', import.meta.url), 'utf8');
	assert.match(source, /presentation === 'documentation' \? saveDocumentationDraft : saveCurrentFile/);
	assert.match(source, /isDocumentation \? renderDocumentationSurface/);
	assert.doesNotMatch(
		source,
		/effectiveMode === 'text'[\s\S]{0,200}DocumentationAutosaveController/,
	);
});
