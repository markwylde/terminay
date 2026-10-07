import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Removing a worktree deletes its files, and each deletion is a status change
 * naming that worktree. The refresh those changes raise is scoped to it and
 * runs after it is gone, so a listing must answer for a worktree that has left
 * the repository rather than refuse the whole project.
 */
async function repositoryWithTwoWorktrees() {
	const root = await realpath(
		await mkdtemp(join(tmpdir(), 'terminay-git-removed-scope-')),
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
	return { root, main, second, run };
}

test('a listing scoped to a worktree removed through the service still lists the project', async (t) => {
	const { GitService } = await import('../dist/gitService/index.js');
	const fixture = await repositoryWithTwoWorktrees();
	t.after(() => rm(fixture.root, { recursive: true, force: true }));

	const service = new GitService();
	const binding = await service.bindProject('project-a', fixture.main);
	const before = await service.worktrees({ projectId: 'project-a' });
	const removed = before.worktrees.find((worktree) => !worktree.isMain);
	assert.ok(removed !== undefined);

	const result = await service.removeWorktree({
		projectId: 'project-a',
		repositoryId: binding.repositoryId,
		worktreeId: removed.id,
		expectedHead: removed.head,
	});
	assert.equal(result.applied, true);

	// The refresh raised by the removed worktree's own file deletions.
	const after = await service.worktrees({
		projectId: 'project-a',
		worktreeId: removed.id,
	});
	assert.equal(after.state, 'ready');
	assert.deepEqual(
		after.worktrees.map((worktree) => worktree.isMain),
		[true],
	);
});

test('a listing scoped to a worktree removed outside the service still lists the project', async (t) => {
	const { GitService } = await import('../dist/gitService/index.js');
	const fixture = await repositoryWithTwoWorktrees();
	t.after(() => rm(fixture.root, { recursive: true, force: true }));

	const service = new GitService();
	await service.bindProject('project-a', fixture.main);
	const before = await service.worktrees({ projectId: 'project-a' });
	const removed = before.worktrees.find((worktree) => !worktree.isMain);
	assert.ok(removed !== undefined);

	// An agent in a terminal, not the Git pane, removes the worktree.
	await fixture.run(['worktree', 'remove', '--force', fixture.second], fixture.main);

	const after = await service.worktrees({
		projectId: 'project-a',
		worktreeId: removed.id,
	});
	assert.equal(after.state, 'ready');
	assert.deepEqual(
		after.worktrees.map((worktree) => worktree.isMain),
		[true],
	);
});

test('a worktree that leaves the listing is announced to its project, and an unchanged listing is not', async (t) => {
	const { GitService } = await import('../dist/gitService/index.js');
	const fixture = await repositoryWithTwoWorktrees();
	t.after(() => rm(fixture.root, { recursive: true, force: true }));

	const service = new GitService();
	await service.bindProject('project-a', fixture.main);
	await service.worktrees({ projectId: 'project-a' });
	const events = [];
	service.subscribe((event) => {
		if (event.type === 'git.status.changed') events.push(event);
	});

	// Nothing changed: listing again announces nothing.
	await service.worktrees({ projectId: 'project-a', fresh: true });
	assert.deepEqual(events, []);

	// Removed from a plain shell. The remaining worktree's own status is
	// unchanged, so only the removal itself can be what is announced.
	await fixture.run(['worktree', 'remove', '--force', fixture.second], fixture.main);
	const after = await service.worktrees({ projectId: 'project-a', fresh: true });
	assert.equal(after.worktrees.length, 1);
	assert.ok(events.some((event) => event.projectId === 'project-a' && event.worktreeId === null));

	// Announcing it resets what the project was last told, so the next listing
	// restates the remaining worktree once. After that it is quiet again.
	await service.worktrees({ projectId: 'project-a', fresh: true });
	events.length = 0;
	await service.worktrees({ projectId: 'project-a', fresh: true });
	assert.deepEqual(events, []);
});
