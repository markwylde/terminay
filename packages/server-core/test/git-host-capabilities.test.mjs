import assert from "node:assert/strict";
import test from "node:test";

test("ServerGitAdapter gates native Git presentation actions and strips path metadata", async () => {
  const { GitService, ServerGitAdapter, GitServiceError } = await import("../dist/gitService/index.js");
  const git = new GitService();
  const calls = [];
  const adapter = new ServerGitAdapter({
    serverId: "server-a",
    git,
    hostCapabilities: ["clipboard"],
    actions: {
      reveal: () => ({ revealed: true, path: "/private/server/project" }),
      copy: (request) => { calls.push(request); return { copied: true, worktreePath: "/private/server/project" }; },
    },
  });
  const authorization = { serverId: "server-a", projectId: "project-a", scope: "write" };
  const reference = { authorization, projectId: "project-a", repositoryId: "repo-a", worktreeId: "worktree-a" };
  await assert.rejects(() => adapter.reveal(reference), (error) => error instanceof GitServiceError && error.code === "invalid-operation" && /nativeWindows/.test(error.message));
  assert.deepEqual(await adapter.copy(reference), { copied: true });
  assert.equal(calls[0].path, undefined);
  assert.equal(Object.hasOwn(calls[0], "worktreePath"), false);
});
