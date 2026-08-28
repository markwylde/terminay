import test from "node:test";
import assert from "node:assert/strict";
import {
  GitServiceError,
  ProjectEnvironmentCapabilityError,
  ProjectEnvironmentRouteError,
  createOperationDispatcher,
} from "../dist/index.js";

function query(dispatcher, operation = "probe") {
  return dispatcher.query({
    envelope: { type: "query", queryId: "q1", operation, payload: {} },
    body: new Uint8Array(),
    context: { connectionId: "c1", clientId: "client-a", authScope: "read", signal: new AbortController().signal },
  });
}

test("project environment routing failures stay typed instead of collapsing to query failed", async () => {
  const cancelled = createOperationDispatcher({
    queries: { probe: async () => { throw new ProjectEnvironmentRouteError("operation-cancelled", "Project environment operation was cancelled."); } },
  });
  assert.deepEqual((await query(cancelled)).envelope.error, { code: "cancelled", message: "Project environment operation was cancelled.", retryable: true });

  const timeout = createOperationDispatcher({
    queries: { probe: async () => { throw new ProjectEnvironmentRouteError("operation-timeout", "Project environment operation timed out.", { retryable: true }); } },
  });
  assert.deepEqual((await query(timeout)).envelope.error, { code: "deadline", message: "Project environment operation timed out.", retryable: true });

  const provider = createOperationDispatcher({
    queries: { probe: async () => { throw new ProjectEnvironmentRouteError("provider-operation-failed", "Project environment provider operation failed.", { retryable: true }); } },
  });
  assert.deepEqual((await query(provider)).envelope.error, { code: "unavailable", message: "Project environment provider operation failed.", retryable: true });

  const capability = createOperationDispatcher({
    queries: { probe: async () => { throw new ProjectEnvironmentCapabilityError("git"); } },
  });
  assert.equal((await query(capability)).envelope.error.code, "unavailable");
  assert.match((await query(capability)).envelope.error.message, /git/u);
});

test("Git service failures keep their public message instead of query failed", async () => {
  const dispatcher = createOperationDispatcher({
    queries: { "git.worktrees.list": async () => { throw new GitServiceError("invalid-project", "project id is invalid"); } },
  });
  const result = await query(dispatcher, "git.worktrees.list");
  assert.deepEqual(result.envelope.error, { code: "validation", message: "project id is invalid", retryable: false });
});
