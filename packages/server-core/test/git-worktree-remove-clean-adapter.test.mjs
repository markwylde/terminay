import test from "node:test";
import assert from "node:assert/strict";

test("Git clean-only removal adapter is a distinct write operation bound to the reviewed HEAD", async () => {
  const { ServerGitAdapter, GIT_OPERATIONS } = await import("../dist/gitService/index.js");
  const calls = [];
  const git = {
    async removeWorktree() {
      throw new Error("clean-only removal must never reach forced removal");
    },
    async removeCleanWorktree(request) {
      calls.push(request);
      return { operation: "remove", projectId: request.projectId, repositoryId: request.repositoryId, worktreeId: request.worktreeId, applied: true, state: "removed", headBefore: request.expectedHead };
    },
  };
  const adapter = new ServerGitAdapter({ serverId: "server-a", git });
  assert.equal(GIT_OPERATIONS.removeCleanWorktree, "git.worktree.remove-clean");
  const command = adapter.operations().commands[GIT_OPERATIONS.removeCleanWorktree];
  const request = (projectId, expectedHead, authScope = "write") => ({
    envelope: { type: "command", commandId: "command-a", correlationId: "correlation-a", operation: GIT_OPERATIONS.removeCleanWorktree, payload: { projectId, repositoryId: "repo-a", worktreeId: "worktree-a", path: "/client/supplied", ...(expectedHead === undefined ? {} : { expectedHead }) } },
    body: new Uint8Array(),
    context: { connectionId: "connection-a", clientId: "client-a", authScope, claims: { projectId: "project-a" }, signal: new AbortController().signal },
  });
  const result = await command(request("project-a", "abc"));
  assert.equal(result.state, "removed");
  assert.deepEqual(Object.keys(calls[0]).sort(), ["expectedHead", "projectId", "repositoryId", "signal", "worktreeId"]);
  assert.equal(calls[0].expectedHead, "abc");
  await assert.rejects(async () => command(request("project-b", "abc")), /authorized scope|outside/u);
  await assert.rejects(async () => command(request("project-a", "abc", "read")), /scope/u);
  await assert.rejects(async () => command(request("project-a", undefined)), /reviewed HEAD/u);
  await assert.rejects(async () => command(request("project-a", null)), /reviewed HEAD/u);
  assert.equal(calls.length, 1);
});
