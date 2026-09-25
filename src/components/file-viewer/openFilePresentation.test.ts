import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	isDocumentPath,
	resolveOpenPresentation,
	viewDocumentSource,
} from './openFilePresentation.ts';

test('openFile finds the canonical panel by path and switches presentation', async () => {
	const source = await readFile(new URL('../../App.tsx', import.meta.url), 'utf8');
	assert.match(source, /filePathPanelMapRef\.current\.get\(filePath\)/);
	assert.match(source, /resolveOpenPresentation\(\s*filePath,\s*options,\s*existingPanel\.params\?\.presentation/);
	assert.match(source, /presentation: resolveOpenPresentation\(filePath, options\)/);
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

test('Markdown and MDX paths are documents, whatever their casing', () => {
	for (const path of ['README.md', 'docs/guide.mdx', '/abs/NOTES.MD', 'a/b.Mdx'])
		assert.equal(isDocumentPath(path), true, path);
	for (const path of ['notes.md.bak', 'app.ts', 'md', 'readme.markdown.txt'])
		assert.equal(isDocumentPath(path), false, path);
});

test('a new panel defaults by file type, not by the surface that opened it', () => {
	assert.equal(resolveOpenPresentation('docs/a.md', undefined), 'documentation');
	assert.equal(resolveOpenPresentation('docs/a.MDX', {}), 'documentation');
	assert.equal(resolveOpenPresentation('src/app.ts', undefined), 'file-viewer');
});

test('a requested File Viewer mode keeps Markdown in the File Viewer', () => {
	for (const initialMode of ['diff', 'text', 'tasks', 'hex', 'preview'])
		assert.equal(resolveOpenPresentation('a.md', { initialMode }), 'file-viewer');
});

test('an explicit presentation always wins', () => {
	assert.equal(
		resolveOpenPresentation('a.md', { presentation: 'file-viewer' }),
		'file-viewer',
	);
	assert.equal(
		resolveOpenPresentation('a.ts', { presentation: 'documentation', initialMode: 'text' }),
		'documentation',
	);
	assert.equal(
		resolveOpenPresentation('a.md', { presentation: 'documentation' }, 'file-viewer'),
		'documentation',
	);
});

test('an existing panel keeps its presentation when nothing is requested', () => {
	assert.equal(resolveOpenPresentation('a.md', undefined, 'file-viewer'), undefined);
	assert.equal(resolveOpenPresentation('a.md', {}, 'documentation'), undefined);
	assert.equal(
		resolveOpenPresentation('a.md', { initialMode: 'diff' }, 'documentation'),
		'file-viewer',
	);
});

test('View source switches only after pending edits flush', async () => {
	let switched = 0;
	assert.equal(await viewDocumentSource(async () => true, () => { switched += 1; }), true);
	assert.equal(switched, 1);
	assert.equal(await viewDocumentSource(async () => false, () => { switched += 1; }), false);
	assert.equal(
		await viewDocumentSource(async () => { throw new Error('save failed'); }, () => { switched += 1; }),
		false,
	);
	assert.equal(switched, 1);
});

test('leaving Documentation for any File Viewer request flushes first', async () => {
	const source = await readFile(new URL('../../App.tsx', import.meta.url), 'utf8');
	assert.match(
		source,
		/existingPanel\.params\?\.presentation === 'documentation' &&\s*presentation === 'file-viewer'[\s\S]{0,300}await flush\(\);\s*\} catch \{\s*return;/,
	);
});

test('both presentations offer a switch on the same panel', async () => {
	const panel = await readFile(new URL('./FilePanel.tsx', import.meta.url), 'utf8');
	assert.match(panel, /isDocumentPath\(fileInfo\.name\) \?[\s\S]{0,300}Open as document/);
	assert.match(panel, /setPresentation\('documentation'\)/);
	assert.match(panel, /\(\) => setPresentation\('file-viewer'\)/);
	assert.match(panel, /updateParameters\(\{ \.\.\.baseParamsRef\.current, presentation: next \}\)/);
	const plugins = await readFile(new URL('./documentationEditorPlugins.tsx', import.meta.url), 'utf8');
	assert.match(plugins, /<ButtonWithTooltip[\s\S]{0,200}title="View source"/);
	const editor = await readFile(new URL('./DocumentationEditor.tsx', import.meta.url), 'utf8');
	assert.match(editor, /viewDocumentSource\(\s*\(\) => autosaveRef\.current\?\.flush\(\)/);
});
