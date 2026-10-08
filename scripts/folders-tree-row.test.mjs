import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * What a folder row of the Folders tree draws for its worktree: the pull
 * request as a link, the checks as the control that opens their list, and how
 * the worktree stands against the default branch.
 */

const require = createRequire(import.meta.url);
const testDirectory = await mkdtemp(join(process.cwd(), '.folders-tree-row-'));

async function bundleModule(entryPoint, outputName) {
	const outputPath = join(testDirectory, outputName);
	await build({
		entryPoints: [entryPoint],
		outfile: outputPath,
		bundle: true,
		format: 'cjs',
		platform: 'node',
		external: ['react', 'react-dom'],
		loader: { '.css': 'empty' },
		logLevel: 'silent',
	});
	return require(outputPath);
}

const { FoldersTree } = await bundleModule(
	'src/components/folders/FoldersTree.tsx',
	'folders-tree.cjs',
);
const { worktreeChange, folderTreeWorktrees } = await bundleModule(
	'src/workspace/folderTreeSources.ts',
	'folder-tree-sources.cjs',
);
const presentation = await bundleModule(
	'src/components/folders/worktreePropertyPresentation.ts',
	'worktree-property-presentation.cjs',
);

test.after(async () => {
	await rm(testDirectory, { recursive: true, force: true });
});

const checks = {
	passed: 12,
	failed: 2,
	pending: 2,
	skipped: 0,
	total: 16,
	items: [
		{ name: 'CI / Lint', state: 'passed' },
		{ name: 'CI / E2E (2/10)', state: 'pending' },
		{ name: 'CI / Build', state: 'failed', url: 'https://git.example.net/r/1' },
	],
};

const linked = (extra = {}) => ({
	id: 'folder-linked',
	name: 'one-project-one-window',
	kind: 'linked',
	isSelected: false,
	worktreePath: '/repo/.worktrees/one-project-one-window',
	branch: 'feat/one-project-one-window',
	terminals: [],
	isEmpty: true,
	...extra,
});

const render = (folders, props = {}) =>
	renderToStaticMarkup(
		React.createElement(FoldersTree, {
			folders,
			onSelectFolder: () => {},
			onSelectTerminal: () => {},
			...props,
		}),
	);

test('the checks tone is failed, then pending, then passed', () => {
	assert.equal(presentation.checksTone(checks), 'failed');
	assert.equal(presentation.checksTone({ ...checks, failed: 0 }), 'pending');
	assert.equal(
		presentation.checksTone({ ...checks, failed: 0, pending: 0 }),
		'passed',
	);
});

test('the pull request and the checks have accessible names with the number and the counts', () => {
	assert.equal(
		presentation.checksAccessibleName(checks),
		'Checks: 2 failed, 12 passed, 2 pending. Show checks',
	);
	assert.match(
		presentation.pullRequestAccessibleName({
			number: 285,
			title: 'About window',
			state: 'open',
		}),
		/^Pull request #285, open: About window\. Open in browser$/,
	);
});

test('check items list failures first, and passes fill what room is left', () => {
	assert.deepEqual(
		presentation.orderedCheckItems(checks).map((item) => item.state),
		['failed', 'pending', 'passed'],
	);
	const many = {
		...checks,
		total: 9,
		items: [
			...Array.from({ length: 7 }, (_, index) => ({
				name: `pass ${index}`,
				state: 'passed',
			})),
			{ name: 'broken', state: 'failed' },
			{ name: 'running', state: 'pending' },
		],
	};
	const { shown, hidden } = presentation.shownCheckItems(many);
	assert.deepEqual(
		shown.map((item) => item.name),
		['broken', 'running', 'pass 0', 'pass 1', 'pass 2', 'pass 3'],
	);
	assert.equal(hidden, 3);
});

test('a linked folder row links its pull request and opens its checks, on one unwrapped line', () => {
	const markup = render(
		[
			linked({
				pullRequest: {
					number: 350,
					state: 'open',
					title: 'One project, one window',
					url: 'https://git.example.net/pulls/350',
				},
				checks: { failed: 0, pending: 0, passed: 26, skipped: 0 },
				change: { kind: 'delta', additions: 1234, deletions: 7 },
			}),
		],
		{ onOpenLink: () => {}, onFolderMenu: () => {} },
	);
	assert.match(
		markup,
		/<button type="button" class="folders-tree__pr folders-tree__pr--link folders-tree__pr--open" aria-label="Pull request #350, open: One project, one window\. Open in browser"[^>]*>#350<\/button>/,
	);
	assert.match(
		markup,
		/<button type="button" class="folders-tree__checks folders-tree__checks--link folders-tree__checks--passed" aria-label="Checks: 0 failed, 26 passed, 0 pending\. Show checks" aria-expanded="false"[^>]*>26<\/button>/,
	);
	assert.match(markup, /folders-tree__delta--additions">\+1\.2k</);
	assert.match(markup, /folders-tree__delta--deletions">−7</);
	// The branch, the change, the pull request, and the checks share one line
	// beneath the name: one meta row, and nothing else added to the folder row.
	assert.equal(markup.match(/class="folders-tree__meta"/g)?.length, 1);
	assert.equal(markup.match(/folders-tree__checks-list/g), null);
});

test('a row that only reports, as in a peek, shows the same facts with nothing to press', () => {
	const markup = render(
		[
			linked({
				pullRequest: {
					number: 350,
					state: 'draft',
					title: 'Draft',
					url: 'https://git.example.net/pulls/350',
				},
				checks: { failed: 1, pending: 2, passed: 3, skipped: 0 },
				change: { kind: 'clean' },
			}),
		],
		{ variant: 'peek' },
	);
	assert.equal(markup.includes('<button'), false);
	assert.match(markup, /folders-tree__pr folders-tree__pr--draft"[^>]*>#350</);
	// Failures are the number shown when there are any.
	assert.match(markup, /folders-tree__checks--failed"[^>]*>1</);
	assert.match(markup, /data-change="clean">clean</);
});

test('a worktree is clean only with nothing unmerged and no delta; a missing one is missing', () => {
	const worktree = {
		isPrunable: false,
		isDirtyBranch: false,
		entries: [],
		lineAdditions: 0,
		lineDeletions: 0,
	};
	assert.deepEqual(worktreeChange(worktree), { kind: 'clean' });
	assert.deepEqual(worktreeChange({ ...worktree, lineAdditions: 3 }), {
		kind: 'delta',
		additions: 3,
		deletions: 0,
	});
	// Committed work the default branch lacks, with no measured size.
	assert.deepEqual(worktreeChange({ ...worktree, isDirtyBranch: true }), {
		kind: 'changed',
	});
	assert.deepEqual(worktreeChange({ ...worktree, entries: [{}] }), {
		kind: 'changed',
	});
	// A registration with no working tree is not clean, whatever its counts.
	assert.deepEqual(worktreeChange({ ...worktree, isPrunable: true }), {
		kind: 'missing',
	});
	assert.equal(
		folderTreeWorktrees({
			gitAvailable: true,
			repoRoot: '/repo',
			defaultBranch: 'main',
			worktrees: [{ ...worktree, path: '/repo', branch: 'main' }],
		})[0].change.kind,
		'clean',
	);
});

test('the forge sign-in prompt is asked by the workspace, once, wherever the sidebar is', async () => {
	const app = await readFile('src/App.tsx', 'utf8');
	const changesPane = await readFile(
		'src/components/git-panel/ChangesPane.tsx',
		'utf8',
	);
	// One place draws it, and it is not the pane that only exists while the
	// sidebar is open on the Explorer group.
	assert.equal(app.match(/<WorktreeSignInDialog/g)?.length, 1);
	assert.doesNotMatch(changesPane, /WorktreeSignInDialog|signIn/);
	const sidebar = app.slice(
		app.indexOf('\t\t\t\t\tnavigation={'),
		app.indexOf('\t\t\t\t\tcontent={'),
	);
	assert.ok(sidebar.length > 0, 'expected the sidebar slot of the workspace');
	assert.doesNotMatch(sidebar, /WorktreeSignInDialog/);
	assert.match(
		app,
		/isActive && worktreePanelStatus\?\.signIn !== undefined \? \(\s*<WorktreeSignInDialog/,
	);
});

test('a plain folder and General show no change, pull request, or checks', () => {
	const markup = render([
		{
			id: 'general',
			name: 'General',
			kind: 'general',
			isSelected: true,
			branch: 'main',
			terminals: [],
			isEmpty: true,
		},
		{
			id: 'plain',
			name: 'Servers',
			kind: 'plain',
			isSelected: false,
			terminals: [],
			isEmpty: true,
		},
	]);
	assert.equal(markup.includes('folders-tree__change'), false);
	assert.equal(markup.includes('folders-tree__pr'), false);
	assert.equal(markup.match(/class="folders-tree__meta"/g)?.length, 1);
});
