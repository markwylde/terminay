import test from "node:test";
import assert from "node:assert/strict";

test("Git move adapter binds authenticated project and accepts only a sibling name", async () => {
  const { ServerGitAdapter, GIT_OPERATIONS } = await import("../dist/gitService/index.js");
  const calls = [];
  const git = {
    async moveWorktree(request) {
      calls.push(request);
      return { operation: "move", projectId: request.projectId, repositoryId: request.repositoryId, worktreeIdBefore: request.worktreeId, worktreeId: "worktree-new", applied: true, state: "moved", headBefore: "abc", headAfter: "abc", path: "/server/renamed" };
    },
  };
  const adapter = new ServerGitAdapter({ serverId: "server-a", git });
  const command = adapter.operations().commands[GIT_OPERATIONS.moveWorktree];
  const request = (projectId, name) => ({
    envelope: { type: "command", commandId: "command-a", correlationId: "correlation-a", operation: GIT_OPERATIONS.moveWorktree, payload: { projectId, repositoryId: "repo-a", worktreeId: "worktree-a", name, expectedHead: "abc" } },
    body: new Uint8Array(),
    context: { connectionId: "connection-a", clientId: "client-a", authScope: "write", claims: { projectId: "project-a" }, signal: new AbortController().signal },
  });
  const result = await command(request("project-a", "renamed"));
  assert.equal(result.worktreeId, "worktree-new");
  assert.deepEqual({ projectId: calls[0].projectId, name: calls[0].name, expectedHead: calls[0].expectedHead }, { projectId: "project-a", name: "renamed", expectedHead: "abc" });
  await assert.rejects(() => command(request("project-b", "renamed")), /authorized scope|outside/u);
  assert.throws(() => command(request("project-a", "../escape")), /name/u);
  assert.equal(calls.length, 1);
});
