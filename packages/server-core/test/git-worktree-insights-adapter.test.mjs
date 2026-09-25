import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ORIGIN = 'https://git.example.net';

const context = (scope, projectId) => ({
	connectionId: 'connection-a',
	clientId: 'client-a',
	authScope: scope,
	claims: { projectId },
	signal: new AbortController().signal,
});
const envelope = (operation, payload) => ({
	envelope: { type: 'query', queryId: 'q', operation, payload },
	body: new Uint8Array(),
});

async function repository() {
	const root = await mkdtemp(join(tmpdir(), 'terminay-git-insights-'));
	const git = (args) =>
		execFileAsync('git', args, {
			cwd: root,
			env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
		});
	await git(['init', '-b', 'main']);
	await git(['config', 'user.email', 'test@example.invalid']);
	await git(['config', 'user.name', 'Terminay Test']);
	await git(['remote', 'add', 'origin', 'ssh://git@git.example.net:4222/owner/repo.git']);
	await git(['config', 'branch.main.remote', 'origin']);
	await git(['config', 'branch.main.merge', 'refs/heads/main']);
	await writeFile(join(root, 'file.txt'), 'base\n');
	await git(['add', 'file.txt']);
	await git(['commit', '-m', 'initial']);
	return root;
}

test('worktree listings carry published properties and sign-in prompts to their project only', async () => {
	const { GitService, ServerGitAdapter, GIT_OPERATIONS, WorktreeInsightService } =
		await import('../dist/index.js');
	const rootA = await repository();
	const rootB = await repository();
	try {
		const git = new GitService({ statusPollIntervalMs: false });
		const announced = [];
		git.subscribe((event) => announced.push(event));
		const vault = new Map();
		const insights = new WorktreeInsightService({
			vault: {
				has: (id) => vault.has(id),
				async put(id, _label, value) { vault.set(id, new TextDecoder().decode(value)); },
				async read(id) { return vault.get(id); },
				async remove(id) { vault.delete(id); },
			},
			onProjectChanged: (projectId, worktreeId) => git.announceWorktreeChange(projectId, worktreeId),
		});
		const contexts = [];
		insights.attach({
			worktreeInsightContributions: () => [{ extensionId: 'com.example.forge', contribution: { id: 'com.example.forge/forge', displayName: 'Forge' } }],
			onContributionsChanged: () => () => {},
			async startWorktreeInsightSource() {},
			async stopWorktreeInsightSource() {},
			async setWorktreeInsightContexts(_sourceId, live) { contexts.push(structuredClone(live)); },
			async notifyWorktreeCredential() {},
		});
		const roots = { 'project-a': rootA, 'project-b': rootB };
		const adapter = new ServerGitAdapter({
			serverId: 'server-a',
			git,
			resolveProjectRoot: (projectId) => roots[projectId] ?? null,
			insights,
		});
		const operations = adapter.operations();
		const list = (projectId) =>
			operations.queries[GIT_OPERATIONS.listWorktrees]({
				...envelope(GIT_OPERATIONS.listWorktrees, { projectId }),
				context: context('read', projectId),
			});

		const first = await list('project-a');
		await list('project-b');
		await new Promise((resolve) => setTimeout(resolve, 20));
		const liveA = contexts.at(-1).find((live) => live.repositoryRoot.endsWith(rootA.split('/').at(-1)));
		assert.ok(liveA, 'project A has a context');
		assert.deepEqual(liveA.remotes, [{ name: 'origin', url: 'ssh://git@git.example.net:4222/owner/repo.git' }]);
		assert.deepEqual(liveA.worktrees[0].upstream, { remote: 'origin', branch: 'main' });
		const worktreeId = first.worktrees[0].id;
		assert.equal(first.worktrees[0].properties, undefined);

		insights.publish({
			extensionId: 'com.example.forge',
			sourceId: 'com.example.forge/forge',
			contextId: liveA.id,
			worktreeId,
			properties: {
				pullRequest: { number: 12, title: 'Feature', url: `${ORIGIN}/owner/repo/pulls/12`, state: 'open' },
				checks: { passed: 1, failed: 1, pending: 0, skipped: 0, total: 2, items: [{ name: 'CI / Build', state: 'failed', url: `${ORIGIN}/owner/repo/actions/runs/1` }, { name: 'CI / Lint', state: 'passed' }] },
			},
		});
		assert.ok(announced.some((event) => event.type === 'git.status.changed' && event.projectId === 'project-a' && event.worktreeId === worktreeId));

		const second = await list('project-a');
		assert.equal(second.worktrees[0].properties.pullRequest.number, 12);
		assert.deepEqual(second.worktrees[0].properties.checks.items, [], 'listings carry counts, not items');
		assert.equal(second.worktrees[0].properties.checks.failed, 1);
		const other = await list('project-b');
		assert.equal(other.worktrees[0].properties, undefined, 'another project sees nothing');

		const full = await operations.queries[GIT_OPERATIONS.worktreeProperties]({
			...envelope(GIT_OPERATIONS.worktreeProperties, { projectId: 'project-a', worktreeId }),
			context: context('read', 'project-a'),
		});
		assert.equal(full.properties.checks.items.length, 2);
		await assert.rejects(
			operations.queries[GIT_OPERATIONS.worktreeProperties]({
				...envelope(GIT_OPERATIONS.worktreeProperties, { projectId: 'project-a', worktreeId }),
				context: context('read', 'project-b'),
			}),
			/outside the authorized scope/,
		);

		insights.requestSignIn({ extensionId: 'com.example.forge', sourceId: 'com.example.forge/forge', request: { origin: ORIGIN, provider: 'Forge' } });
		await new Promise((resolve) => setTimeout(resolve, 0));
		const prompted = await list('project-a');
		assert.deepEqual(prompted.signIn, { extensionId: 'com.example.forge', origin: ORIGIN, provider: 'Forge' });
		await assert.rejects(
			operations.commands[GIT_OPERATIONS.signIn]({
				...envelope(GIT_OPERATIONS.signIn, { projectId: 'project-a', origin: ORIGIN, choice: 'accept', token: 'abc' }),
				context: context('read', 'project-a'),
			}),
			/write scope/,
		);
		await operations.commands[GIT_OPERATIONS.signIn]({
			...envelope(GIT_OPERATIONS.signIn, { projectId: 'project-a', origin: ORIGIN, choice: 'accept', token: 'abc' }),
			context: context('write', 'project-a'),
		});
		assert.equal((await list('project-a')).signIn, undefined);
		assert.equal([...vault.values()][0], 'abc');

		await operations.commands[GIT_OPERATIONS.setInsightPrompts]({
			...envelope(GIT_OPERATIONS.setInsightPrompts, { extensionId: 'com.example.forge', enabled: false }),
			context: context('write', 'project-a'),
		});
		const preferences = await operations.queries[GIT_OPERATIONS.insightPreferences]({
			...envelope(GIT_OPERATIONS.insightPreferences, {}),
			context: context('read', 'project-a'),
		});
		assert.deepEqual(preferences.suppressedExtensions, ['com.example.forge']);
		git.close();
	} finally {
		await rm(rootA, { recursive: true, force: true });
		await rm(rootB, { recursive: true, force: true });
	}
});
