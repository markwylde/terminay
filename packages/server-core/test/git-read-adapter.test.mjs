import assert from "node:assert/strict";
import test from "node:test";

test("Git protocol adapter exposes status and diff as project-scoped read queries", async () => {
  const { ServerGitAdapter, GIT_OPERATIONS } = await import("../dist/gitService/index.js");
  const calls = [];
  const adapter = new ServerGitAdapter({
    serverId: "server-a",
    git: {
      async readOnly(request) {
        calls.push(request);
        return { operation: request.operation, projectId: request.projectId, repositoryId: request.repositoryId ?? null, worktreeId: request.worktreeId ?? null, path: request.path ?? null };
      },
    },
  });
  const query = async (operation, payload) => adapter.operations().queries[operation]({
    envelope: { type: "query", queryId: `query-${operation.replaceAll(".", "-")}`, operation, payload },
    body: new Uint8Array(),
    context: { connectionId: "connection-a", clientId: "client-a", authScope: "read", claims: { projectId: "project-a" }, signal: new AbortController().signal },
  });
  assert.deepEqual(await query(GIT_OPERATIONS.status, { repositoryId: "repo-a", worktreeId: "worktree-a" }), { operation: "status", projectId: "project-a", repositoryId: "repo-a", worktreeId: "worktree-a", path: null });
  assert.deepEqual(await query(GIT_OPERATIONS.diff, { repositoryId: "repo-a", worktreeId: "worktree-a", path: "src/file.ts" }), { operation: "diff", projectId: "project-a", repositoryId: "repo-a", worktreeId: "worktree-a", path: "src/file.ts" });
  assert.equal(calls.every((request) => !Object.hasOwn(request, "cwd")), true);
});
