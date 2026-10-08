import assert from 'node:assert/strict';
import test from 'node:test';
import {
	folderMenuEntries,
	folderMenuLabels,
} from '../src/workspace/folderMenuModel.ts';

const worktree = (extra = {}) => ({
	branch: 'feat/folders',
	isBare: false,
	isCurrent: false,
	isDetached: false,
	isMain: false,
	isPrunable: false,
	...extra,
});
const rootCheckout = worktree({ branch: 'main', isCurrent: true, isMain: true });
const labels = (input) => folderMenuLabels(folderMenuEntries(input));
const entry = (input, id) =>
	folderMenuEntries(input).find((candidate) => candidate.id === id);

const linked = {
	kind: 'linked',
	isGitProject: true,
	worktree: worktree(),
	canReveal: true,
};

test('a linked folder offers the worktree actions, Rename worktree, and Delete worktree, and no Rename folder', () => {
	assert.deepEqual(labels(linked), [
		'Commit & push with AI…',
		'Pull from origin',
		'Rename worktree',
		'Delete worktree',
		'Copy path',
		'Copy relative path',
		'Open shell in folder',
		'Reveal in OS',
	]);
	assert.equal(entry(linked, 'delete-worktree').danger, true);
	// A linked folder goes only when its worktree does.
	assert.equal(entry(linked, 'delete-folder'), undefined);
	for (const item of folderMenuEntries(linked))
		if (item.separator !== true) assert.equal(item.disabled, false, item.label);
});

test('General in a Git project offers the Git and directory actions for the root checkout', () => {
	const general = {
		kind: 'general',
		isGitProject: true,
		worktree: rootCheckout,
		canReveal: true,
	};
	assert.deepEqual(labels(general), [
		'Commit & push with AI…',
		'Pull from origin',
		'Copy path',
		'Copy relative path',
		'Open shell in folder',
		'Reveal in OS',
	]);
});

test('a plain folder offers rename, delete, and the directory actions, and nothing Git-shaped', () => {
	// Even in a Git project, and even if it were handed a worktree.
	const plain = {
		kind: 'plain',
		isGitProject: true,
		worktree: undefined,
		canReveal: true,
	};
	assert.deepEqual(labels(plain), [
		'Rename folder',
		'Delete folder',
		'Copy path',
		'Open shell in folder',
		'Reveal in OS',
	]);
	assert.equal(entry(plain, 'delete-folder').danger, true);
	for (const item of folderMenuEntries(plain))
		if (item.separator !== true) assert.equal(item.disabled, false, item.label);
});

test('General outside a repository offers the directory actions only', () => {
	assert.deepEqual(
		labels({
			kind: 'general',
			isGitProject: false,
			worktree: undefined,
			canReveal: true,
		}),
		['Copy path', 'Open shell in folder', 'Reveal in OS'],
	);
});

test('Reveal in OS is offered only where the server can reveal', () => {
	assert.equal(labels({ ...linked, canReveal: false }).includes('Reveal in OS'), false);
});

test('Pull from origin is unavailable for the reasons the worktree action gives', () => {
	const pull = (extra) =>
		entry({ ...linked, worktree: worktree(extra) }, 'pull').disabled;
	assert.equal(pull({}), false);
	assert.equal(pull({ branch: null }), true, 'no branch to pull');
	assert.equal(pull({ isDetached: true }), true, 'detached HEAD');
	assert.equal(pull({ isBare: true }), true, 'bare worktree');
	assert.equal(pull({ isPrunable: true }), true, 'working tree missing');
	assert.equal(pull({ errorMessage: 'Git failed' }), true, 'worktree in error');
	const pulling = entry({ ...linked, isPulling: true }, 'pull');
	assert.equal(pulling.disabled, true);
	assert.equal(pulling.label, 'Pulling from origin…');
});

test('the other Git actions keep the worktree action rules', () => {
	const of = (extra, id) => entry({ ...linked, worktree: worktree(extra) }, id).disabled;
	// Commit & push: not for a bare, missing, or failing worktree.
	assert.equal(of({ isBare: true }, 'commit-and-push'), true);
	assert.equal(of({ isPrunable: true }, 'commit-and-push'), true);
	assert.equal(of({ errorMessage: 'x' }, 'commit-and-push'), true);
	assert.equal(of({ isDetached: true }, 'commit-and-push'), false);
	// A missing working tree can still be deleted, to clear Git's record, but
	// not renamed; the main and current worktrees can be neither.
	assert.equal(of({ isPrunable: true }, 'delete-worktree'), false);
	assert.equal(of({ isPrunable: true }, 'rename-worktree'), true);
	assert.equal(of({ isMain: true }, 'delete-worktree'), true);
	assert.equal(of({ isCurrent: true }, 'rename-worktree'), true);
	// Nothing to open, copy, or show for a bare or missing worktree.
	for (const id of ['copy-path', 'copy-relative-path', 'open-shell', 'reveal'])
		assert.equal(of({ isPrunable: true }, id), true, id);
});

test('a linked folder whose worktree is not listed offers nothing to run', () => {
	const unlisted = { ...linked, worktree: undefined };
	for (const item of folderMenuEntries(unlisted)) {
		if (item.separator === true) continue;
		assert.equal(item.disabled, true, item.label);
	}
});

test('a worktree being deleted offers no action', () => {
	for (const item of folderMenuEntries({ ...linked, isDeleting: true }))
		if (item.separator !== true) assert.equal(item.disabled, true, item.label);
});
