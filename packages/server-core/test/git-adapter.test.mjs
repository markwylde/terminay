import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const authorization = (scope = 'write', projectId = 'project-a') => ({
	serverId: 'server-a',
	projectId,
	scope,
});
const context = (scope = 'write') => ({
	connectionId: 'connection-a',
	clientId: 'client-a',
	authScope: scope,
	claims: { projectId: 'project-a' },
	signal: new AbortController().signal,
});

test('Git protocol adapter lists canonical worktrees and delegates opaque worktree actions', async () => {
	const { GitService, ServerGitAdapter, GIT_OPERATIONS, GitServiceError } =
		await import('../dist/gitService/index.js');
	const root = await mkdtemp(join(tmpdir(), 'terminay-git-adapter-'));
	try {
		await initialise(root);
		const git = new GitService();
		const binding = await git.bindProject('project-a', root);
		const calls = [];
		const adapter = new ServerGitAdapter({
			serverId: 'server-a',
			git,
			actions: {
				openTerminal: (request) => {
					calls.push(['open', request]);
					return { opened: true };
				},
				switchProject: (request) => {
					calls.push(['switch', request]);
					return { switched: true };
				},
				renamePresentation: (request) => {
					calls.push(['rename', request]);
					return { renamed: request.name };
				},
				reveal: (request) => {
					calls.push(['reveal', request]);
					return { revealed: true };
				},
				copy: (request) => {
					calls.push(['copy', request]);
					return { copied: true };
				},
			},
		});
		const listed = await adapter.list({
			authorization: authorization('read'),
			repositoryId: binding.repositoryId,
		});
		assert.equal(listed.defaultBranch, 'main');
		assert.equal(listed.worktrees.length, 1);
		const worktreeId = listed.worktrees[0].id;

		const operations = adapter.operations();
		const query = await operations.queries[GIT_OPERATIONS.listWorktrees]({
			envelope: {
				type: 'query',
				queryId: 'git-list',
				operation: GIT_OPERATIONS.listWorktrees,
				payload: { repositoryId: binding.repositoryId },
			},
			body: new Uint8Array(),
			context: context('read'),
		});
		assert.equal(query.defaultBranch, 'main');
		const base = { repositoryId: binding.repositoryId, worktreeId };
		const command = async (operation, payload) =>
			operations.commands[operation]({
				envelope: {
					type: 'command',
					commandId: `git-${operation}`,
					correlationId: `correlation-${operation}`,
					operation,
					payload,
				},
				body: new Uint8Array(),
				context: context('write'),
			});
		assert.deepEqual(await command(GIT_OPERATIONS.openTerminal, base), {
			opened: true,
		});
		assert.deepEqual(await command(GIT_OPERATIONS.switchProject, base), {
			switched: true,
		});
		assert.deepEqual(
			await command(GIT_OPERATIONS.renamePresentation, {
				...base,
				name: 'Feature worktree',
			}),
			{ renamed: 'Feature worktree' },
		);
		assert.deepEqual(
			await command(GIT_OPERATIONS.reveal, { ...base, userGesture: true }),
			{ revealed: true },
		);
		assert.deepEqual(
			await command(GIT_OPERATIONS.copy, { ...base, userGesture: true }),
			{ copied: true },
		);
		assert.equal(calls.length, 5);
		assert.equal(
			calls.every(([, request]) => !Object.hasOwn(request, 'path')),
			true,
		);
		assert.equal(calls[0][1].projectId, 'project-a');
		await assert.rejects(
			() =>
				new ServerGitAdapter({ serverId: 'server-a', git }).reveal({
					authorization: authorization(),
					...base,
				}),
			(error) =>
				error instanceof GitServiceError && error.code === 'invalid-operation',
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('Git protocol adapter lazily binds a workspace project root before listing worktrees', async () => {
	const { GitService, ServerGitAdapter } =
		await import('../dist/gitService/index.js');
	const root = await mkdtemp(join(tmpdir(), 'terminay-git-adapter-lazy-bind-'));
	try {
		await initialise(root);
		const canonicalRoot = await realpath(root);
		const git = new GitService();
		const adapter = new ServerGitAdapter({
			serverId: 'server-a',
			git,
			resolveProjectRoot: (projectId) =>
				projectId === 'project-a' ? root : null,
		});
		const listed = await adapter.list({
			authorization: authorization('read'),
			projectId: 'project-a',
		});
		assert.equal(listed.repositoryRoot, canonicalRoot);
		assert.equal(listed.state, 'ready');
		assert.equal(listed.defaultBranch, 'main');
		assert.equal(listed.worktrees.length, 1);
		assert.equal(git.getBinding('project-a')?.projectRoot, canonicalRoot);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('Git protocol adapter rebinds Git when the workspace project root changes', async () => {
	const { GitService, ServerGitAdapter } =
		await import('../dist/gitService/index.js');
	const plainRoot = await mkdtemp(
		join(tmpdir(), 'terminay-git-adapter-plain-root-'),
	);
	const repoRoot = await mkdtemp(
		join(tmpdir(), 'terminay-git-adapter-repo-root-'),
	);
	try {
		await initialise(repoRoot);
		const canonicalRepoRoot = await realpath(repoRoot);
		let currentRoot = plainRoot;
		const git = new GitService();
		await git.bindProject('project-a', plainRoot);
		const adapter = new ServerGitAdapter({
			serverId: 'server-a',
			git,
			resolveProjectRoot: (projectId) =>
				projectId === 'project-a' ? currentRoot : null,
		});
		const initial = await adapter.list({
			authorization: authorization('read'),
			projectId: 'project-a',
		});
		assert.equal(initial.state, 'not-repository');

		currentRoot = repoRoot;
		const rebound = await adapter.list({
			authorization: authorization('read'),
			projectId: 'project-a',
		});
		assert.equal(rebound.repositoryRoot, canonicalRepoRoot);
		assert.equal(rebound.state, 'ready');
		assert.equal(rebound.defaultBranch, 'main');
		assert.equal(rebound.worktrees.length, 1);
		assert.equal(git.getBinding('project-a')?.projectRoot, canonicalRepoRoot);
	} finally {
		await rm(plainRoot, { recursive: true, force: true });
		await rm(repoRoot, { recursive: true, force: true });
	}
});

test('Git protocol adapter resolves the default branch for provider planning and binds approvals to project', async () => {
	const { GitService, GitQuickPushService, ServerGitAdapter, GitServiceError } =
		await import('../dist/gitService/index.js');
	const root = await mkdtemp(
		join(tmpdir(), 'terminay-git-adapter-quick-push-'),
	);
	try {
		await initialise(root);
		const git = new GitService();
		const binding = await git.bindProject('project-a', root);
		let plannedBranch;
		const quickPush = new GitQuickPushService(
			git,
			{
				plan: async (proposalContext) => {
					plannedBranch = proposalContext.branch;
					return {
						actions: [
							{
								kind: 'push',
								target: 'main',
								summary: 'Push reviewed branch',
								mutatesRevision: false,
							},
						],
					};
				},
			},
			{ execute: async () => ({ applied: true }) },
		);
		const adapter = new ServerGitAdapter({
			serverId: 'server-a',
			git,
			quickPush,
		});
		const proposal = await adapter.proposeQuickPush({
			authorization: authorization(),
			projectId: 'project-a',
			repositoryId: binding.repositoryId,
			worktreeId: binding.worktreeId,
			provider: 'codex',
		});
		assert.equal(proposal.targetBranch, 'main');
		assert.equal(plannedBranch, 'main');
		const result = await adapter.approveQuickPush({
			authorization: authorization(),
			proposalId: proposal.proposalId,
			revision: proposal.revision,
			actionDigest: proposal.actionDigest,
		});
		assert.equal(result.applied, true);
		await assert.rejects(
			() =>
				adapter.approveQuickPush({
					authorization: authorization(),
					proposalId: proposal.proposalId,
					revision: proposal.revision,
					actionDigest: proposal.actionDigest,
				}),
			(error) =>
				error instanceof GitServiceError && error.code === 'proposal-replayed',
		);
		await assert.rejects(
			() =>
				adapter.proposeQuickPush({
					authorization: authorization('write', 'project-a'),
					projectId: 'project-b',
					repositoryId: binding.repositoryId,
					worktreeId: binding.worktreeId,
					provider: 'codex',
				}),
			(error) =>
				error instanceof GitServiceError &&
				error.code === 'repository-mismatch',
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

async function initialise(root) {
	await mkdir(root, { recursive: true });
	await git(['init', '-b', 'main'], root);
	await git(['config', 'user.email', 'test@example.invalid'], root);
	await git(['config', 'user.name', 'Terminay Test'], root);
	await writeFile(join(root, 'file.txt'), 'base\n');
	await git(['add', 'file.txt'], root);
	await git(['commit', '-m', 'initial'], root);
}

async function git(args, cwd) {
	await execFileAsync('git', args, {
		cwd,
		env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
	});
}
