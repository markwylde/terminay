import assert from 'node:assert/strict';
import test from 'node:test';
import {
	folderChanges,
	folderDirectory,
	isGitProject,
	worktreeOfFolder,
} from '../src/workspace/folderWorktree.ts';

const worktree = (path, extra = {}) => ({
	path,
	name: path.split('/').at(-1),
	branch: 'main',
	head: 'a'.repeat(40),
	isCurrent: false,
	isMain: false,
	isBare: false,
	isDetached: false,
	isLocked: false,
	isPrunable: false,
	entries: [],
	...extra,
});

/** A repository at /work/repo with two other worktrees. */
const status = {
	gitAvailable: true,
	repoRoot: '/work/repo',
	defaultBranch: 'main',
	worktrees: [
		worktree('/work/repo', {
			isCurrent: true,
			isMain: true,
			entries: [{ path: '/work/repo/README.md', relativePath: 'README.md' }],
		}),
		worktree('/work/repo-feature', {
			branch: 'feat/folders',
			entries: [
				{ path: '/work/repo-feature/a.ts', relativePath: 'a.ts' },
				{ path: '/work/repo-feature/b.ts', relativePath: 'b.ts' },
			],
		}),
		worktree('/work/repo-other', { branch: 'fix/other' }),
	],
};
const notARepository = {
	gitAvailable: true,
	repoRoot: null,
	defaultBranch: null,
	worktrees: [],
};
const general = { kind: 'general' };
const plain = { kind: 'plain' };
const linked = {
	kind: 'linked',
	worktree: { repositoryId: 'r', path: '/work/repo-feature' },
};

test('General and a plain folder stand for the checkout at the project root', () => {
	assert.equal(worktreeOfFolder(general, '/work/repo', status)?.path, '/work/repo');
	assert.equal(worktreeOfFolder(plain, '/work/repo', status)?.path, '/work/repo');
});

test('a linked folder stands for the listed worktree whose path its link names', () => {
	assert.equal(
		worktreeOfFolder(linked, '/work/repo', status)?.path,
		'/work/repo-feature',
	);
	// A trailing separator or a /private prefix is the same directory.
	assert.equal(
		worktreeOfFolder(
			{ kind: 'linked', worktree: { repositoryId: 'r', path: '/work/repo-feature/' } },
			'/work/repo',
			status,
		)?.branch,
		'feat/folders',
	);
});

test('a project root below its checkout is still that checkout', () => {
	const unmarked = {
		...status,
		worktrees: status.worktrees.map((entry) => ({ ...entry, isCurrent: false })),
	};
	assert.equal(
		worktreeOfFolder(general, '/work/repo/packages/app', unmarked)?.path,
		'/work/repo',
	);
});

test('Changes reports one worktree: its branch and its changes, and no other', () => {
	const forLinked = folderChanges(linked, '/work/repo', status);
	assert.equal(forLinked.kind, 'worktree');
	assert.equal(forLinked.status.branch, 'feat/folders');
	assert.equal(forLinked.status.repoRoot, '/work/repo-feature');
	assert.deepEqual(
		forLinked.status.entries.map((entry) => entry.relativePath),
		['a.ts', 'b.ts'],
	);
	const forGeneral = folderChanges(general, '/work/repo', status);
	assert.equal(forGeneral.kind, 'worktree');
	assert.equal(forGeneral.status.branch, 'main');
	assert.deepEqual(
		forGeneral.status.entries.map((entry) => entry.relativePath),
		['README.md'],
	);
	// A plain folder is the project root, so it reports what General reports.
	assert.deepEqual(folderChanges(plain, '/work/repo', status), forGeneral);
});

test('a folder outside a repository is told so', () => {
	assert.deepEqual(folderChanges(general, '/notes', notARepository), {
		kind: 'not-a-repository',
	});
	assert.deepEqual(folderChanges(plain, '/notes', notARepository), {
		kind: 'not-a-repository',
	});
	assert.equal(isGitProject(notARepository), false);
	assert.equal(isGitProject(status), true);
	assert.equal(isGitProject(null), false);
});

test('before a listing arrives, and without Git, Changes says which', () => {
	assert.deepEqual(folderChanges(general, '/work/repo', null), { kind: 'loading' });
	assert.deepEqual(
		folderChanges(general, '/work/repo', { ...notARepository, gitAvailable: false }),
		{ kind: 'git-unavailable' },
	);
	assert.equal(isGitProject({ ...notARepository, gitAvailable: false }), false);
});

test('a linked folder whose worktree has left the listing reports that, not another worktree', () => {
	const gone = {
		kind: 'linked',
		worktree: { repositoryId: 'r', path: '/work/repo-removed' },
	};
	assert.equal(worktreeOfFolder(gone, '/work/repo', status), undefined);
	assert.deepEqual(folderChanges(gone, '/work/repo', status), {
		kind: 'worktree-unlisted',
	});
});

test('a folder menu copies the worktree of a linked folder and the project root of a plain one', () => {
	assert.equal(folderDirectory(linked, '/work/repo', status), '/work/repo-feature');
	assert.equal(folderDirectory(plain, '/work/repo/packages/app', status), '/work/repo/packages/app');
	assert.equal(folderDirectory(general, '/work/repo', status), '/work/repo');
	assert.equal(folderDirectory(general, '/notes', notARepository), '/notes');
});
