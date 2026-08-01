import assert from 'node:assert/strict';
import test from 'node:test';
import type { TerminayGitClient } from '@terminay/client-core';
import {
	beginDirectoryLoad,
	isCurrentDirectoryLoad,
	loadGitWorkspaceFromServer,
} from './useFileExplorerController';

test('only the newest directory refresh may reconcile its snapshot', () => {
	const versions = new Map<string, number>();
	const path = '/workspace';
	const refreshContainingDeletedFile = beginDirectoryLoad(versions, path);
	const refreshAfterDeletion = beginDirectoryLoad(versions, path);

	assert.equal(
		isCurrentDirectoryLoad(versions, path, refreshContainingDeletedFile),
		false,
	);
	assert.equal(
		isCurrentDirectoryLoad(versions, path, refreshAfterDeletion),
		true,
	);
});

test('Git workspace refresh uses only the server projection', async () => {
	const gitClient = {
		async list(request: { projectId?: string }) {
			assert.equal(request.projectId, 'default');
			return {
				defaultBranch: null,
				repositoryRoot: null,
				state: 'not-a-repository',
				worktrees: [],
			};
		},
	} as unknown as TerminayGitClient;

	const projection = await loadGitWorkspaceFromServer(gitClient, {
		id: 'default',
		rootFolder: '/repo-from-terminal-cwd',
	});

	assert.equal(projection.worktrees.repoRoot, null);
	assert.deepEqual(projection.worktrees.worktrees, []);
});
