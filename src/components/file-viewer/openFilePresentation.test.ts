import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isDocumentPath, leaveDocumentView } from './openFilePresentation.ts';

test('openFile finds the canonical panel by path and opens no presentation', async () => {
	const source = await readFile(new URL('../../App.tsx', import.meta.url), 'utf8');
	assert.match(source, /filePathPanelMapRef\.current\.get\(filePath\)/);
	assert.match(source, /existingPanel\.api\.setActive\(\)/);
	assert.doesNotMatch(source, /presentation: 'documentation'/);
	assert.doesNotMatch(source, /resolveOpenPresentation|presentationForFolder/);
});

test('the Documentation pane and document links open with no named view', async () => {
	const editor = await readFile(new URL('./DocumentationEditor.tsx', import.meta.url), 'utf8');
	assert.match(editor, /onExternalUrl=\{\(url\) => \{\s*void openExternalUrl\(url\);/);
	assert.match(editor, /terminay-documentation-open/);
	assert.match(editor, /kind === 'open-document'/);
	const app = await readFile(new URL('../../App.tsx', import.meta.url), 'utf8');
	assert.match(app, /terminay-documentation-open/);
	assert.match(app, /void openFile\(path\);/);
	assert.match(app, /onOpen=\{\(path\) => openFile\(path\)\}/);
});

test('only the Document view autosaves and is flushed on close', async () => {
	const panel = await readFile(new URL('./FilePanel.tsx', import.meta.url), 'utf8');
	assert.match(
		panel,
		/mode === 'document' \? saveDocumentationDraft : saveCurrentFile,\s*mode === 'document',/,
	);
	assert.match(panel, /effectiveMode === 'document' \? renderDocumentationSurface/);
	assert.doesNotMatch(
		panel,
		/effectiveMode === 'text'[\s\S]{0,200}DocumentationAutosaveController/,
	);
	const app = await readFile(new URL('../../App.tsx', import.meta.url), 'utf8');
	assert.match(app, /registration\?\.autosaves === true[\s\S]{0,80}await registration\.save\(\)/);
});

test('leaving Document flushes first, whoever asked for the new view', async () => {
	const panel = await readFile(new URL('./FilePanel.tsx', import.meta.url), 'utf8');
	assert.match(
		panel,
		/modeRef\.current === 'document' &&\s*nextMode !== 'document' &&\s*!\(await leaveDocumentView\(/,
	);
	// A view requested by another surface goes through the same switch.
	assert.match(panel, /void handleModeChangeRef\.current\(customEvent\.detail\.mode\)/);
});

test('there is no separate document presentation to switch to or from', async () => {
	const panel = await readFile(new URL('./FilePanel.tsx', import.meta.url), 'utf8');
	assert.doesNotMatch(panel, /Open as document|setPresentation/);
	const plugins = await readFile(new URL('./documentationEditorPlugins.tsx', import.meta.url), 'utf8');
	assert.doesNotMatch(plugins, /View source/);
});

test('Markdown and MDX paths are documents, whatever their casing', () => {
	for (const path of ['README.md', 'docs/guide.mdx', '/abs/NOTES.MD', 'a/b.Mdx'])
		assert.equal(isDocumentPath(path), true, path);
	for (const path of ['notes.md.bak', 'app.ts', 'md', 'readme.markdown.txt'])
		assert.equal(isDocumentPath(path), false, path);
});

test('the Document view is left only after pending edits flush', async () => {
	assert.equal(await leaveDocumentView(async () => true), true);
	assert.equal(await leaveDocumentView(async () => false), false);
	assert.equal(
		await leaveDocumentView(async () => {
			throw new Error('save failed');
		}),
		false,
	);
});
