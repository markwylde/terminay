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
const { folderOrderAfterMove } = await bundleModule(
	'src/workspace/folderTreeModel.ts',
	'folder-tree-model.cjs',
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
	isDirty: false,
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

const general = (extra = {}) => ({
	id: 'folder-general',
	name: 'General',
	kind: 'general',
	isSelected: false,
	isDirty: false,
	branch: 'main',
	terminals: [],
	isEmpty: true,
	...extra,
});

const terminalRow = (extra = {}) => ({
	panelId: 'panel-1',
	sessionId: 'session-1',
	title: 'Terminal 2',
	status: 'idle',
	isActive: false,
	...extra,
});

test('the chips say the pull request with its state unless open, and the checks as a count and a word', () => {
	assert.deepEqual(presentation.pullRequestChip({ number: 350, state: 'open' }), {
		prefix: 'PR',
		number: '#350',
	});
	assert.deepEqual(presentation.pullRequestChip({ number: 351, state: 'draft' }), {
		prefix: 'PR',
		number: '#351',
		state: 'draft',
	});
	assert.equal(
		presentation.pullRequestChip({ number: 352, state: 'merged' }).state,
		'merged',
	);
	assert.deepEqual(presentation.checksChip(checks), { count: 2, word: 'failed' });
	assert.deepEqual(presentation.checksChip({ ...checks, failed: 0 }), {
		count: 2,
		word: 'running',
	});
	assert.deepEqual(
		presentation.checksChip({ ...checks, failed: 0, pending: 0 }),
		{ count: 12, word: 'passed' },
	);
	// Only a linked folder with work in it and no pull request says so.
	const noPr = presentation.showsNoPullRequest;
	assert.equal(noPr({ kind: 'linked', isDirty: true }), true);
	assert.equal(noPr({ kind: 'linked', isDirty: false }), false);
	assert.equal(noPr({ kind: 'general', isDirty: true }), false);
	assert.equal(
		noPr({ kind: 'linked', isDirty: true, pullRequest: { number: 1 } }),
		false,
	);
	// Pushed and not merged is still work nobody has asked to merge.
	assert.equal(
		noPr({ kind: 'linked', isDirty: false, unmerged: { commits: 2 } }),
		true,
	);
	assert.equal(
		noPr({ kind: 'general', isDirty: false, unmerged: { commits: 2 } }),
		false,
	);
	assert.deepEqual(presentation.unmergedMark({ commits: 4 }), {
		text: '↑4',
		label: '4 commits not on the default branch',
	});
	assert.deepEqual(presentation.unmergedMark({ commits: 1 }), {
		text: '↑1',
		label: '1 commit not on the default branch',
	});
	assert.deepEqual(presentation.unmergedMark({ commits: null }), {
		text: '↑',
		label: 'Commits not on the default branch',
	});
});

test('an unmerged branch ends with its mark whether or not the checkout is dirty, and a merged one has none', () => {
	const pushed = render([
		linked({ change: { kind: 'clean' }, unmerged: { commits: 4 } }),
	]);
	assert.match(pushed, /class="folders-tree__branch"/);
	assert.equal(pushed.includes('folders-tree__branch--dirty'), false);
	assert.match(
		pushed,
		/<span title="feat\/one-project-one-window">feat\/one-project-one-window<\/span><span class="folders-tree__unmerged" role="img" aria-label="4 commits not on the default branch" title="4 commits not on the default branch">↑4<\/span>/,
	);
	// Nothing unpushed, so no change size; pushed with no pull request says so.
	assert.equal(pushed.includes('folders-tree__change'), false);
	assert.match(pushed, /folders-tree__chip--quiet">no PR</);

	const local = render([
		linked({
			isDirty: true,
			change: { kind: 'delta', additions: 12, deletions: 3 },
			unmerged: { commits: 5 },
		}),
	]);
	assert.match(local, /folders-tree__branch folders-tree__branch--dirty"/);
	assert.match(local, /folders-tree__unmerged"[^>]*>↑5</);
	assert.match(local, /folders-tree__delta--additions">\+12</);

	const merged = render([linked({ change: { kind: 'clean' } })]);
	assert.equal(merged.includes('folders-tree__unmerged'), false);
});

test('a linked folder card has a title line, a branch line, and a facts line, in that order', () => {
	const markup = render(
		[
			linked({
				isDirty: true,
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
	const title = markup.indexOf('class="folders-tree__title"');
	const branch = markup.indexOf('class="folders-tree__branch folders-tree__branch--dirty"');
	const facts = markup.indexOf('class="folders-tree__facts"');
	assert.ok(title !== -1 && title < branch && branch < facts, markup);
	assert.match(
		markup,
		/<button type="button" class="folders-tree__chip folders-tree__pr folders-tree__pr--open folders-tree__pr--link" aria-label="Pull request #350, open: One project, one window\. Open in browser"[^>]*><span class="folders-tree__chip-extra">PR<\/span><span>#350<\/span><\/button>/,
	);
	assert.match(
		markup,
		/<button type="button" class="folders-tree__chip folders-tree__checks folders-tree__checks--passed folders-tree__checks--link" aria-label="Checks: 0 failed, 26 passed, 0 pending\. Show checks" aria-expanded="false"[^>]*>.*?<span>26<\/span><span class="folders-tree__chip-extra">passed<\/span><\/button>/,
	);
	assert.match(markup, /folders-tree__delta--additions">\+1\.2k</);
	assert.match(markup, /folders-tree__delta--deletions">−7</);
	assert.match(markup, /class="folders-tree__row folders-tree__row--folder"[^>]*data-change="delta"/);
	// One facts line, and the checks are not listed until they are opened.
	assert.equal(markup.match(/class="folders-tree__facts"/g)?.length, 1);
	assert.equal(markup.match(/folders-tree__checks-list/g), null);
	assert.equal(markup.includes('no PR'), false);
});

test('a branch takes the accent only when its checkout is dirty, and a dirty linked folder with no pull request says so', () => {
	const dirty = render([linked({ isDirty: true, change: { kind: 'changed' } })]);
	assert.match(dirty, /folders-tree__branch folders-tree__branch--dirty"/);
	assert.match(dirty, /folders-tree__change--changed">changed</);
	assert.match(dirty, /folders-tree__chip--quiet">no PR</);

	const clean = render([linked({ change: { kind: 'clean' } })]);
	assert.match(clean, /class="folders-tree__branch"/);
	assert.equal(clean.includes('folders-tree__branch--dirty'), false);
	// Clean draws no chip and no facts line; the header still says which it is.
	assert.equal(clean.includes('folders-tree__facts'), false);
	assert.match(clean, /data-change="clean"/);
	assert.equal(clean.includes('>clean<'), false);

	const merged = render([
		linked({
			change: { kind: 'clean' },
			pullRequest: { number: 352, state: 'merged', title: 'Banner' },
		}),
	]);
	assert.match(
		merged,
		/folders-tree__pr--merged"[^>]*><span class="folders-tree__chip-extra">PR<\/span><span>#352<\/span><span>merged<\/span>/,
	);
	assert.equal(merged.includes('folders-tree__branch--dirty'), false);

	// General is measured like any other checkout, and never asked for a pull request.
	const root = render([
		general({ isDirty: true, change: { kind: 'delta', additions: 4, deletions: 1 } }),
	]);
	assert.match(root, /folders-tree__branch folders-tree__branch--dirty"/);
	assert.match(root, /folders-tree__delta--additions">\+4</);
	assert.equal(root.includes('no PR'), false);

	const plain = render([
		{ id: 'p', name: 'Servers', kind: 'plain', isSelected: false, isDirty: false, terminals: [], isEmpty: true },
	]);
	assert.equal(plain.includes('folders-tree__branch'), false);
	assert.equal(plain.includes('folders-tree__facts'), false);
});

test('every card ends with New terminal where one can be made, and an empty folder shows no placeholder', () => {
	const markup = render(
		[general(), linked({ terminals: [terminalRow()], isEmpty: false })],
		{ onNewTerminal: () => {} },
	);
	assert.equal(markup.match(/class="folders-tree__new-terminal"/g)?.length, 2);
	assert.match(markup, /aria-label="New terminal in General"/);
	assert.match(markup, /aria-label="New terminal in one-project-one-window"/);
	assert.equal(markup.includes('No terminals yet'), false);
	// The row is the last thing in its card.
	assert.match(markup, /<span>New terminal<\/span><\/button><\/div>/);
	// Without a way to make one there is no row.
	assert.equal(render([general()]).includes('New terminal'), false);
});

test('every folder but General has a grip where folders can be reordered, and a peek has none', () => {
	const folders = [
		general(),
		linked(),
		{ id: 'p', name: 'Servers', kind: 'plain', isSelected: false, isDirty: false, terminals: [], isEmpty: true },
	];
	const markup = render(folders, { onReorderFolders: () => {} });
	assert.equal(markup.match(/class="folders-tree__grip"/g)?.length, 2);
	assert.match(markup, /aria-label="Reorder one-project-one-window"/);
	assert.match(markup, /aria-label="Reorder Servers"/);
	assert.equal(markup.includes('aria-label="Reorder General"'), false);
	assert.equal(render(folders, { variant: 'peek' }).includes('folders-tree__grip'), false);
	assert.equal(render(folders).includes('folders-tree__grip'), false);
});

test('a moved folder never goes above General, and General is never the one moved', () => {
	const ids = ['general', 'alpha', 'beta', 'gamma'];
	assert.deepEqual(folderOrderAfterMove(ids, 'gamma', 1), ['general', 'gamma', 'alpha', 'beta']);
	assert.deepEqual(folderOrderAfterMove(ids, 'gamma', 0), ['general', 'gamma', 'alpha', 'beta']);
	assert.deepEqual(folderOrderAfterMove(ids, 'gamma', -5), ['general', 'gamma', 'alpha', 'beta']);
	assert.deepEqual(folderOrderAfterMove(ids, 'alpha', 2), ['general', 'beta', 'alpha', 'gamma']);
	assert.deepEqual(folderOrderAfterMove(ids, 'alpha', 99), ['general', 'beta', 'gamma', 'alpha']);
	assert.deepEqual(folderOrderAfterMove(ids, 'alpha', 1), ids);
	assert.deepEqual(folderOrderAfterMove(ids, 'general', 3), ids);
	assert.deepEqual(folderOrderAfterMove(ids, 'missing', 2), ids);
});

test('the selected folder is tinted only when none of its terminals is the active one', () => {
	const withActive = render([
		linked({
			isSelected: true,
			isEmpty: false,
			terminals: [terminalRow({ isActive: true })],
		}),
	]);
	assert.match(withActive, /folders-tree__row--folder folders-tree__row--selected"/);
	assert.equal(withActive.includes('folders-tree__row--selected-alone'), false);
	assert.match(withActive, /folders-tree__row--terminal folders-tree__row--active"/);

	const alone = render([linked({ isSelected: true })]);
	assert.match(
		alone,
		/folders-tree__row--folder folders-tree__row--selected folders-tree__row--selected-alone"/,
	);
	assert.equal(alone.includes('folders-tree__row--active'), false);
});

test('a card that only reports, as in a peek, shows the same facts with nothing to press', () => {
	const markup = render(
		[
			linked({
				isDirty: true,
				pullRequest: {
					number: 350,
					state: 'draft',
					title: 'Draft',
					url: 'https://git.example.net/pulls/350',
				},
				checks: { failed: 1, pending: 2, passed: 3, skipped: 0 },
				change: { kind: 'changed' },
			}),
		],
		{ variant: 'peek' },
	);
	assert.equal(markup.includes('<button'), false);
	assert.match(markup, /folders-tree__pr folders-tree__pr--draft"[^>]*>.*?<span>#350<\/span><span>draft<\/span>/);
	// Failures are the number shown when there are any.
	assert.match(markup, /folders-tree__checks--failed"[^>]*>.*?<span>1<\/span>/);
	assert.match(markup, /folders-tree__branch--dirty/);
	assert.equal(markup.includes('New terminal'), false);
});

test('a worktree is clean only with nothing unpushed and no working-tree entry; a missing one is missing', () => {
	const worktree = {
		isPrunable: false,
		isDirtyBranch: false,
		aheadOfMainCount: 0,
		hasUnpushedCommits: false,
		entries: [],
		lineAdditions: 0,
		lineDeletions: 0,
		unpushedLineAdditions: 0,
		unpushedLineDeletions: 0,
	};
	assert.deepEqual(worktreeChange(worktree), { kind: 'clean' });
	assert.deepEqual(worktreeChange({ ...worktree, unpushedLineAdditions: 3 }), {
		kind: 'delta',
		additions: 3,
		deletions: 0,
	});
	// Unpushed commits with no measured size.
	assert.deepEqual(worktreeChange({ ...worktree, hasUnpushedCommits: true }), {
		kind: 'changed',
	});
	// Pushed work the default branch lacks is not a change on this machine.
	assert.deepEqual(
		worktreeChange({
			...worktree,
			isDirtyBranch: true,
			lineAdditions: 247,
			lineDeletions: 13,
		}),
		{ kind: 'clean' },
	);
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

test('a plain folder and a clean General show no facts line: General its branch alone, a plain folder nothing', () => {
	const markup = render([
		{
			id: 'general',
			name: 'General',
			kind: 'general',
			isSelected: true,
			isDirty: false,
			branch: 'main',
			terminals: [],
			isEmpty: true,
		},
		{
			id: 'plain',
			name: 'Servers',
			kind: 'plain',
			isSelected: false,
			isDirty: false,
			terminals: [],
			isEmpty: true,
		},
	]);
	assert.equal(markup.includes('folders-tree__change'), false);
	assert.equal(markup.includes('folders-tree__pr'), false);
	assert.equal(markup.includes('folders-tree__facts'), false);
	assert.equal(markup.match(/class="folders-tree__branch"/g)?.length, 1);
});
