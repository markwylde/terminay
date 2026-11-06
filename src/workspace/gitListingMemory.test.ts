import assert from 'node:assert/strict';
import test from 'node:test';
import { createGitListingMemory, type GitListing } from './gitListingMemory.ts';

const listing = (branch: string, worktrees = 1): GitListing => ({
	referencesByPath: new Map(),
	statuses: {},
	worktrees: {
		gitAvailable: true,
		repoRoot: '/repo',
		defaultBranch: 'main',
		worktrees: Array.from({ length: worktrees }, () => ({ branch })) as never,
	},
});

test('a remembered listing is recalled for its project and root', () => {
	const memory = createGitListingMemory();
	const alpha = listing('alpha');
	memory.remember('p1', '/repo', alpha);
	assert.equal(memory.recall('p1', '/repo'), alpha);
});

test('another project recalls nothing', () => {
	const memory = createGitListingMemory();
	memory.remember('p1', '/repo', listing('alpha'));
	assert.equal(memory.recall('p2', '/repo'), undefined);
});

test('another root of the same project recalls nothing', () => {
	const memory = createGitListingMemory();
	memory.remember('p1', '/repo', listing('alpha'));
	assert.equal(memory.recall('p1', '/elsewhere'), undefined);
});

test('a root left and returned to recalls nothing until it is remembered again', () => {
	const memory = createGitListingMemory();
	memory.remember('p1', '/a', listing('alpha'));
	memory.remember('p1', '/b', listing('beta'));
	assert.equal(memory.recall('p1', '/a'), undefined);
	const again = listing('alpha-again');
	memory.remember('p1', '/a', again);
	assert.equal(memory.recall('p1', '/a'), again);
	assert.equal(memory.recall('p1', '/b'), undefined);
});

test('a later listing replaces an earlier one, an empty listing included', () => {
	const memory = createGitListingMemory();
	memory.remember('p1', '/repo', listing('alpha'));
	const empty = listing('none', 0);
	memory.remember('p1', '/repo', empty);
	assert.equal(memory.recall('p1', '/repo'), empty);
});
