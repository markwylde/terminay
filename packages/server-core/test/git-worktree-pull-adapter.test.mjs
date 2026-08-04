import assert from "node:assert/strict";
import test from "node:test";

test("Git protocol adapter binds pull to the opaque repository/worktree identity", async () => {
  const { ServerGitAdapter, GIT_OPERATIONS } = await import("../dist/gitService/index.js");
  const calls = [];
  const adapter = new ServerGitAdapter({
    serverId: "server-a",
    git: {
      async pullWorktree(request) {
        calls.push(request);
        return { operation: "pull", projectId: request.projectId, repositoryId: request.repositoryId, worktreeId: request.worktreeId, applied: true, state: "pulled", headBefore: "abc", headAfter: "def" };
      },
    },
  });
  const operation = adapter.operations().commands[GIT_OPERATIONS.pull];
  const result = await operation({
    envelope: { type: "command", commandId: "pull-a", correlationId: "corr-a", operation: GIT_OPERATIONS.pull, payload: { projectId: "project-a", repositoryId: "repo-a", worktreeId: "worktree-a", expectedHead: "abc" } },
    body: new Uint8Array(),
    context: { connectionId: "connection-a", clientId: "client-a", authScope: "write", claims: { projectId: "project-a" }, signal: new AbortController().signal },
  });
  assert.equal(result.applied, true);
  assert.deepEqual(calls[0], { projectId: "project-a", repositoryId: "repo-a", worktreeId: "worktree-a", expectedHead: "abc", signal: calls[0].signal });
  assert.equal(Object.hasOwn(calls[0], "path"), false);
});
