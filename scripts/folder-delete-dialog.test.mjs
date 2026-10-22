import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * The one dialog a folder or worktree delete asks: Cancel and Delete, the
 * removal warning for a worktree, and a choice about the panels it holds.
 */

const require = createRequire(import.meta.url);
const testDirectory = await mkdtemp(join(process.cwd(), '.folder-delete-dialog-'));
const outputPath = join(testDirectory, 'folder-delete-dialog.cjs');
await build({
	entryPoints: ['src/components/folders/FolderDeleteDialog.tsx'],
	outfile: outputPath,
	bundle: true,
	format: 'cjs',
	platform: 'node',
	external: ['react', 'react-dom'],
	loader: { '.css': 'empty' },
	logLevel: 'silent',
});
const { FolderDeleteDialog, RunningNote } = require(outputPath);

test.after(async () => {
	await rm(testDirectory, { recursive: true, force: true });
});

const idle = { count: 0, limited: false };
const render = (props) =>
	renderToStaticMarkup(
		React.createElement(FolderDeleteDialog, { onAnswer: () => {}, ...props }),
	);

test('a worktree with panels shows its warning, the choice, Cancel, and Delete', () => {
	const html = render({
		folderName: 'feature',
		worktree: { path: '/repo-feature', warning: 'This permanently removes it.' },
		panelCount: 2,
		running: idle,
	});
	assert.match(html, /Delete Worktree/);
	assert.match(html, /\/repo-feature/);
	assert.match(html, /This permanently removes it\./);
	assert.match(html, /still holds 2 panels/);
	assert.match(html, /Move to General/);
	assert.match(html, /Close them/);
	assert.match(html, />Cancel</);
	assert.match(html, />Delete</);
	// Move to General is selected when the dialog opens.
	assert.match(html, /checked="" value="move"/);
	assert.doesNotMatch(html, /checked="" value="close"/);
});

test('a worktree with no panels offers no choice about them', () => {
	const html = render({
		folderName: 'feature',
		worktree: { path: '/repo-feature', warning: 'Gone.' },
		panelCount: 0,
		running: idle,
	});
	assert.match(html, /Delete Worktree/);
	assert.doesNotMatch(html, /type="radio"/);
	assert.match(html, />Delete</);
});

test('a plain folder carries no worktree warning', () => {
	const html = render({ folderName: 'Notes', panelCount: 1, running: idle });
	assert.match(html, /Delete Folder/);
	assert.doesNotMatch(html, /data-folder-delete-warning/);
	assert.match(html, /still holds 1 panel\./);
});

test('the running line is not shown while Move to General is selected', () => {
	const html = render({
		folderName: 'feature',
		panelCount: 1,
		running: { count: 1, limited: false },
	});
	assert.doesNotMatch(html, /data-folder-delete-running/);
});

test('the running line counts busy terminals, or says it could not check', () => {
	const note = (running) =>
		renderToStaticMarkup(React.createElement(RunningNote, { running }));
	assert.match(note({ count: 1, limited: false }), /1 terminal has a process running/);
	assert.match(note({ count: 3, limited: true }), /3 terminals have a process running/);
	assert.match(note({ count: 0, limited: true }), /could not check/);
	assert.equal(note(idle), '');
});
