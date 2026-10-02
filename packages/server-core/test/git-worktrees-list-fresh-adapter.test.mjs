import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { createCountingRunner, createFakeWatcher, createRepository, eventually } from "./fixtures/git-observation.mjs";

/**
 * `git.worktrees.list` accepts an optional boolean `fresh`. Set, the listing is
 * measured whatever the watches report; absent or false, a clean observed
 * repository is answered from its cached listing.
 */
async function adapterOverObservedRepository(t) {
  const { GIT_OPERATIONS, GitService, NodeGitCommandRunner, ServerGitAdapter } = await import(
    "../dist/gitService/index.js"
  );
  const fixture = await createRepository();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const runner = createCountingRunner(NodeGitCommandRunner);
  const watcher = createFakeWatcher();
  const git = new GitService({ runner, watcher, refreshRampMs: [0] });
  t.after(() => git.close());
  await git.bindProject("project-a", fixture.main);
  await eventually(() => watcher.isWatching(fixture.gitDir), "Git directory watch was not established");
  const adapter = new ServerGitAdapter({ serverId: "server-a", git });
  const list = (payload) =>
    adapter.operations().queries[GIT_OPERATIONS.listWorktrees]({
      envelope: { type: "query", queryId: "git-list", operation: GIT_OPERATIONS.listWorktrees, payload },
      body: new Uint8Array(),
      context: {
        connectionId: "connection-a",
        clientId: "client-a",
        authScope: "read",
        claims: { projectId: "project-a" },
        signal: new AbortController().signal,
      },
    });
  await list({});
  runner.calls.length = 0;
  return { list, runner, fixture };
}

test("a listing without fresh is answered from the cached listing", async (t) => {
  const { list, runner } = await adapterOverObservedRepository(t);
  assert.equal((await list({})).state, "ready");
  assert.equal((await list({ fresh: false })).state, "ready");
  assert.deepEqual(runner.calls, []);
});

test("a fresh listing is measured", async (t) => {
  const { list, runner, fixture } = await adapterOverObservedRepository(t);
  const listed = await list({ fresh: true });
  assert.equal(listed.state, "ready");
  assert.ok(runner.statusAgainst(fixture.main) > 0);
});

test("a fresh flag that is not a boolean is refused", async (t) => {
  const { list, runner } = await adapterOverObservedRepository(t);
  for (const fresh of ["true", 1, null, {}])
    await assert.rejects(async () => list({ fresh }), /fresh is invalid/u, JSON.stringify(fresh));
  assert.deepEqual(runner.calls, []);
});
