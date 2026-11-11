import assert from 'node:assert/strict';
import test from 'node:test';
import { openInWorktree, startWorkPlanState } from './forgeActions.ts';

const REPOSITORY = { origin: 'https://git.example.net', owner: 'acme', name: 'app' };

function steps(overrides: Partial<Parameters<typeof openInWorktree>[0]> = {}) {
	const log: string[] = [];
	return {
		log,
		steps: {
			createWorktree: async (request: { branch: string; base: string }) => {
				log.push(`create ${request.branch} ${request.base}`);
				return { path: `/repo-${request.branch}` };
			},
			folderForWorktree: async (projectId: string, path: string) => {
				log.push(`folder ${projectId} ${path}`);
				return `folder:${path}`;
			},
			selectFolder: (projectId: string, folderId: string) => log.push(`select ${projectId} ${folderId}`),
			startTerminal: async (projectId: string, folderId: string, launcher?: { launcherId: string; prompt: string }) => {
				log.push(`terminal ${projectId} ${folderId} ${launcher === undefined ? 'shell' : `${launcher.launcherId}:${launcher.prompt}`}`);
				return true;
			},
			...overrides,
		},
	};
}

test('Check out creates a tracking worktree and selects its folder', async () => {
	const { log, steps: s } = steps();
	const result = await openInWorktree(
		s,
		{ create: { projectId: 'p', repository: REPOSITORY, branch: 'change/13', base: 'track', remoteBranch: 'change/13', reuseExisting: true } },
		{ kind: 'none' },
	);
	assert.deepEqual(result, { ok: true });
	assert.deepEqual(log, ['create change/13 track', 'folder p /repo-change/13', 'select p folder:/repo-change/13']);
});

test('Review with agent in a matched worktree creates nothing', async () => {
	const { log, steps: s } = steps();
	await openInWorktree(
		s,
		{ match: { projectId: 'p', worktreeId: 'w', branch: 'b', path: '/wt' } },
		{ kind: 'launcher', launcherId: 'codex', prompt: 'Review #88' },
	);
	assert.deepEqual(log, ['folder p /wt', 'terminal p folder:/wt codex:Review #88']);
});

test('Start work opens a shell, or a launcher with its prompt', async () => {
	const { log, steps: s } = steps();
	const create = { projectId: 'p', repository: REPOSITORY, branch: 'issue-541-x', base: 'default' as const };
	await openInWorktree(s, { create }, { kind: 'shell' });
	assert.equal(log.at(-1), 'terminal p folder:/repo-issue-541-x shell');
	await openInWorktree(s, { create }, { kind: 'launcher', launcherId: 'claude', prompt: 'Work on issue #541' });
	assert.equal(log.at(-1), 'terminal p folder:/repo-issue-541-x claude:Work on issue #541');
});

test('a retry after the terminal failed opens it in the worktree already made', async () => {
	let worktrees = 0;
	let terminalWorks = false;
	const { log, steps: s } = steps({
		createWorktree: async () => {
			worktrees += 1;
			return worktrees === 1
				? { path: '/repo-issue-1' }
				: { path: null, error: { code: 'checkedOut', message: 'already checked out', path: '/repo-issue-1' } };
		},
		startTerminal: async (projectId, folderId) => {
			log.push(`terminal ${projectId} ${folderId}`);
			return terminalWorks;
		},
	});
	const create = { projectId: 'p', repository: REPOSITORY, branch: 'issue-1', base: 'default' as const };
	const first = await openInWorktree(s, { create }, { kind: 'shell' });
	assert.equal(first.ok, false);
	terminalWorks = true;
	const second = await openInWorktree(s, { create }, { kind: 'shell' });
	assert.deepEqual(second, { ok: true });
	assert.deepEqual(log.filter((line) => line.startsWith('terminal')), ['terminal p folder:/repo-issue-1', 'terminal p folder:/repo-issue-1']);
});

test('a refused creation is reported with its reason and code', async () => {
	const { log, steps: s } = steps({
		createWorktree: async () => ({ path: null, error: { code: 'branchExists', message: 'branch exists' } }),
	});
	const result = await openInWorktree(
		s,
		{ create: { projectId: 'p', repository: REPOSITORY, branch: 'x', base: 'default' } },
		{ kind: 'shell' },
	);
	assert.deepEqual(result, { ok: false, message: 'branch exists', code: 'branchExists' });
	assert.deepEqual(log, []);
});

test('Start work offers an existing branch and waits for the choice', () => {
	const plan = { path: '/repo-x', branchValid: true, branchExists: true, checkedOutAt: null };
	assert.deepEqual(startWorkPlanState(plan, false), { note: 'Worktree: /repo-x', offerExisting: true, reuseExisting: false, blocked: true });
	assert.equal(startWorkPlanState(plan, true).blocked, false);
	assert.equal(startWorkPlanState(plan, true).reuseExisting, true);
	assert.equal(startWorkPlanState({ ...plan, branchValid: false }, false).blocked, true);
	const out = startWorkPlanState({ ...plan, checkedOutAt: '/repo-x' }, false);
	assert.equal(out.reuseExisting, true);
	assert.match(out.note, /opens there/u);
	assert.equal(startWorkPlanState({ ...plan, branchExists: false }, false).offerExisting, false);
});
