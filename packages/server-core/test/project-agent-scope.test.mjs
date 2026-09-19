import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gitWorktrees, ProjectAgentScope } from '../dist/index.js';

function git(cwd, ...args) {
	execFileSync('git', ['-C', cwd, ...args], {
		stdio: 'ignore',
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 't',
			GIT_AUTHOR_EMAIL: 't@t',
			GIT_COMMITTER_NAME: 't',
			GIT_COMMITTER_EMAIL: 't@t',
		},
	});
}

async function repository(t) {
	const base = await realpath(await mkdtemp(join(tmpdir(), 'terminay-scope-')));
	t.after(() => rm(base, { recursive: true, force: true }));
	const root = join(base, 'app');
	await mkdir(join(root, 'packages', 'api'), { recursive: true });
	git(base, 'init', '-q', root);
	git(root, 'commit', '-q', '--allow-empty', '-m', 'init');
	return { base, root };
}

async function eventually(check, timeoutMs = 5_000) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (await check()) return;
		if (Date.now() > deadline) throw new Error('condition never held');
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

test('git worktree listing includes linked worktrees outside the root', async (t) => {
	const { base, root } = await repository(t);
	const linked = join(base, 'app-feature');
	git(root, 'worktree', 'add', '-q', linked, '-b', 'feature');
	const repo = await gitWorktrees(root);
	assert.equal(repo.commonDir, join(root, '.git'));
	assert.deepEqual(repo.worktrees.sort(), [root, linked].sort());
});

test('a directory outside any repository has no worktrees', async (t) => {
	const base = await realpath(
		await mkdtemp(join(tmpdir(), 'terminay-scope-plain-')),
	);
	t.after(() => rm(base, { recursive: true, force: true }));
	assert.equal(await gitWorktrees(base), undefined);
});

test('scope covers the root, its subdirectories, and every worktree; nothing else', async (t) => {
	const { base, root } = await repository(t);
	const linked = join(base, 'app-feature');
	git(root, 'worktree', 'add', '-q', linked, '-b', 'feature');
	const scope = new ProjectAgentScope();
	t.after(() => scope.dispose());
	scope.setProject('p', root);
	await scope.settled();
	assert.deepEqual(scope.projectIdsFor(join(root, 'packages', 'api')), ['p']);
	assert.deepEqual(scope.projectIdsFor(join(linked, 'src')), ['p']);
	assert.deepEqual(scope.projectIdsFor(`${root}-other`), []);
	assert.deepEqual(scope.projectIdsFor(join(base, 'elsewhere')), []);
});

test('a worktree added after binding is picked up by the metadata watch', async (t) => {
	const { base, root } = await repository(t);
	const scope = new ProjectAgentScope({ ramp: { intervalsMs: [10] } });
	t.after(() => scope.dispose());
	let changes = 0;
	scope.onChanged(() => {
		changes += 1;
	});
	scope.setProject('p', root);
	await scope.settled();
	const later = join(base, 'later');
	assert.deepEqual(scope.projectIdsFor(later), []);
	git(root, 'worktree', 'add', '-q', later, '-b', 'later');
	await eventually(async () => {
		await scope.settled();
		return scope.projectIdsFor(later).length === 1;
	});
	assert.ok(changes >= 2);
});

test('overlapping projects both claim a session', async (t) => {
	const { root } = await repository(t);
	const scope = new ProjectAgentScope({
		resolveWorktrees: async () => undefined,
	});
	t.after(() => scope.dispose());
	scope.setProject('outer', root);
	scope.setProject('inner', join(root, 'packages'));
	await scope.settled();
	assert.deepEqual(scope.projectIdsFor(join(root, 'packages', 'api')), [
		'inner',
		'outer',
	]);
	scope.removeProject('inner');
	assert.deepEqual(scope.projectIdsFor(join(root, 'packages', 'api')), [
		'outer',
	]);
});
