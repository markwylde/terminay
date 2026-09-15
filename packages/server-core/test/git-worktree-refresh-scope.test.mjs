import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Every per-worktree Git command is a spawned process, and an endpoint-security
 * agent charges for each one — a fresh binary to authorise plus the tree walk
 * behind it. A change in one worktree must not re-measure the others, so these
 * count commands rather than timing them.
 */
async function repositoryWithTwoWorktrees() {
	const root = await realpath(
		await mkdtemp(join(tmpdir(), 'terminay-git-scope-')),
	);
	const main = join(root, 'main');
	const run = (args, cwd) => execFileAsync('git', args, { cwd });
	await execFileAsync('git', ['init', '-b', 'main', main]);
	await run(['config', 'user.email', 'test@example.com'], main);
	await run(['config', 'user.name', 'Test'], main);
	await writeFile(join(main, 'a.txt'), 'a\n');
	await run(['add', '.'], main);
	await run(['commit', '-m', 'first'], main);
	const second = join(root, 'second');
	await run(['worktree', 'add', '-b', 'feature', second], main);
	return { root, main, second };
}

/** Wraps the default runner so commands can be counted per worktree. */
async function countingService(GitService, DefaultRunner) {
	const inner = new DefaultRunner();
	const calls = [];
	const service = new GitService({
		statusPollIntervalMs: false,
		runner: {
			run: (args, cwd, options) => {
				calls.push({ args: [...args], cwd });
				return inner.run(args, cwd, options);
			},
		},
	});
	return { service, calls };
}

function commandsAgainst(calls, path) {
	return calls.filter((call) => call.cwd === path).length;
}

test('a listing scoped to one worktree runs no Git command against the others', async (t) => {
	const module = await import('../dist/gitService/index.js');
	const { GitService } = module;
	const DefaultRunner =
		module.NodeGitCommandRunner ?? module.DefaultGitCommandRunner;
	assert.ok(DefaultRunner !== undefined, 'a default runner must be exported');

	const fixture = await repositoryWithTwoWorktrees();
	t.after(() => rm(fixture.root, { recursive: true, force: true }));

	const { service, calls } = await countingService(GitService, DefaultRunner);
	await service.bindProject('project-a', fixture.main);

	const first = await service.worktrees({ projectId: 'project-a' });
	assert.equal(first.state, 'ready');
	assert.equal(first.worktrees.length, 2);
	assert.ok(
		commandsAgainst(calls, fixture.second) > 0,
		'the first listing measures both worktrees',
	);

	const mainWorktree = first.worktrees.find((worktree) =>
		worktree.path.endsWith('main'),
	);
	assert.ok(mainWorktree !== undefined);

	calls.length = 0;
	const scoped = await service.worktrees({
		projectId: 'project-a',
		worktreeId: mainWorktree.id,
	});

	assert.equal(
		commandsAgainst(calls, fixture.second),
		0,
		'a listing naming one worktree must issue no command against the other',
	);
	assert.equal(
		scoped.worktrees.length,
		2,
		'a scoped listing still reports every worktree',
	);
	const carried = scoped.worktrees.find((worktree) => worktree.id !== mainWorktree.id);
	const originally = first.worktrees.find((worktree) => worktree.id !== mainWorktree.id);
	assert.deepEqual(
		carried,
		originally,
		'the out-of-scope worktree is carried forward unchanged',
	);
});

test('a scoped listing still measures a worktree it has never seen', async (t) => {
	const module = await import('../dist/gitService/index.js');
	const { GitService } = module;
	const DefaultRunner =
		module.NodeGitCommandRunner ?? module.DefaultGitCommandRunner;

	const fixture = await repositoryWithTwoWorktrees();
	t.after(() => rm(fixture.root, { recursive: true, force: true }));

	const { service } = await countingService(GitService, DefaultRunner);
	await service.bindProject('project-a', fixture.main);
	const first = await service.worktrees({ projectId: 'project-a' });
	const knownId = first.worktrees[0].id;

	const third = join(fixture.root, 'third');
	await execFileAsync('git', ['worktree', 'add', '-b', 'extra', third], {
		cwd: fixture.main,
	});

	const scoped = await service.worktrees({
		projectId: 'project-a',
		worktreeId: knownId,
	});
	assert.equal(
		scoped.worktrees.length,
		3,
		'a worktree with no previous summary is measured even when out of scope',
	);
});

test('an unattributed listing measures every worktree', async (t) => {
	const module = await import('../dist/gitService/index.js');
	const { GitService } = module;
	const DefaultRunner =
		module.NodeGitCommandRunner ?? module.DefaultGitCommandRunner;

	const fixture = await repositoryWithTwoWorktrees();
	t.after(() => rm(fixture.root, { recursive: true, force: true }));

	const { service } = await countingService(GitService, DefaultRunner);
	await service.bindProject('project-a', fixture.main);
	await service.worktrees({ projectId: 'project-a' });

	await writeFile(join(fixture.second, 'b.txt'), 'b\n');
	const full = await service.worktrees({ projectId: 'project-a' });
	const second = full.worktrees.find((worktree) =>
		worktree.path.endsWith('second'),
	);
	assert.ok(second !== undefined);
	assert.ok(
		second.entries.length > 0,
		'an unattributed refresh picks up the untracked file',
	);
});
