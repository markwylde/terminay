import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const testDirectory = await mkdtemp(join(process.cwd(), '.changes-pane-'));

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

const { ChangesPane } = await bundleModule(
	'src/components/git-panel/ChangesPane.tsx',
	'changes-pane.cjs',
);
const { folderChanges } = await bundleModule(
	'src/workspace/folderWorktree.ts',
	'folder-worktree.cjs',
);

test.after(async () => {
	await rm(testDirectory, { recursive: true, force: true });
});

const entry = (root, relativePath, state = 'modified') => ({
	path: `${root}/${relativePath}`,
	relativePath,
	isDirectory: false,
	state,
	staged: false,
});
const worktree = (path, extra = {}) => ({
	path,
	name: path.split('/').at(-1),
	branch: 'main',
	head: 'a'.repeat(40),
	aheadOfMainCount: 0,
	lineAdditions: 0,
	lineDeletions: 0,
	lastChangedAt: null,
	isDirtyBranch: false,
	isCurrent: false,
	isMain: false,
	isBare: false,
	isDetached: false,
	isLocked: false,
	isPrunable: false,
	entries: [],
	...extra,
});
/** A root checkout with one change and a linked worktree with two. */
const status = {
	gitAvailable: true,
	repoRoot: '/work/repo',
	defaultBranch: 'main',
	worktrees: [
		worktree('/work/repo', {
			isCurrent: true,
			isMain: true,
			entries: [entry('/work/repo', 'README.md')],
		}),
		worktree('/work/repo-feature', {
			branch: 'feat/linked-folders',
			entries: [
				entry('/work/repo-feature', 'src/tree.ts'),
				entry('/work/repo-feature', 'src/new.ts', 'untracked'),
			],
		}),
	],
};
const linked = {
	kind: 'linked',
	worktree: { repositoryId: 'r', path: '/work/repo-feature' },
};

function render(folder, worktreeStatus, props = {}) {
	return renderToStaticMarkup(
		React.createElement(ChangesPane, {
			changes: folderChanges(folder, '/work/repo', worktreeStatus),
			viewMode: 'list',
			onDelete: () => {},
			onNewFile: () => {},
			onNewFolder: () => {},
			onOpenEntry: () => {},
			onOpenFolder: () => {},
			onRename: () => {},
			...props,
		}),
	);
}

test('a linked folder shows its own branch and changes and none from another worktree', () => {
	const html = render(linked, status);
	assert.match(html, /feat\/linked-folders/);
	assert.match(html, /tree\.ts/);
	assert.match(html, /new\.ts/);
	assert.doesNotMatch(html, /README\.md/);
	// One worktree, so nothing lists or names the others.
	assert.doesNotMatch(html, /worktrees-panel/);
	assert.doesNotMatch(html, /\/work\/repo"/);
});

test('General and a plain folder show the checkout at the project root', () => {
	for (const kind of ['general', 'plain']) {
		const html = render({ kind }, status);
		assert.match(html, /changes-pane__branch-name">main</);
		assert.match(html, /README\.md/);
		assert.doesNotMatch(html, /tree\.ts/);
	}
});

test('list and tree presentations show the same changes', () => {
	const list = render(linked, status, { viewMode: 'list' });
	const tree = render(linked, status, { viewMode: 'tree' });
	for (const name of ['tree.ts', 'new.ts']) {
		assert.ok(list.includes(name));
		assert.ok(tree.includes(name));
	}
	// The tree groups by directory; the list names each file's directory.
	assert.match(tree, /git-panel__folder/);
	assert.doesNotMatch(list, /git-panel__folder"/);
});

test('a folder outside a repository is told so and offered nothing', () => {
	const html = render(
		{ kind: 'general' },
		{ gitAvailable: true, repoRoot: null, defaultBranch: null, worktrees: [] },
	);
	assert.match(html, /not in a Git repository/);
	assert.match(html, /data-changes-state="not-a-repository"/);
	assert.doesNotMatch(html, /<button/);
	assert.doesNotMatch(html, /changes-pane__branch/);
});

test('a worktree with nothing changed says so under its branch', () => {
	const clean = {
		...status,
		worktrees: [worktree('/work/repo', { isCurrent: true, isMain: true })],
	};
	const html = render({ kind: 'general' }, clean);
	assert.match(html, /changes-pane__branch-name">main</);
	assert.match(html, /No changes/);
});

test('the sidebar pane keeps its stored id and is titled Changes', async () => {
	const app = await readFile('src/App.tsx', 'utf8');
	const pane = app.slice(app.indexOf("\t\t\t\tgit: {\n\t\t\t\t\tid: 'git',"));
	assert.ok(pane.length > 0 && pane.length < app.length, 'expected the git pane item');
	const item = pane.slice(0, pane.indexOf('documentation: {'));
	assert.match(item, /title: 'Changes'/);
	assert.match(item, /<ChangesPane/);
	assert.match(item, /height: project\.sidebarGitHeight/);
	assert.match(item, /collapsed: project\.isGitPaneCollapsed/);
	assert.doesNotMatch(item, /Git actions|title: 'Git'/);
	assert.doesNotMatch(app, /WorktreesPanel/);
});
