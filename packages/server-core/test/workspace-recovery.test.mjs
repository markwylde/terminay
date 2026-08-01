import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceStore, createInitialWorkspace, reportWorkspaceRecovery } from "../dist/index.js";

test("workspace recovery reports missing roots and interrupted sessions without replacing canonical state", async () => {
  const store = new WorkspaceStore(createInitialWorkspace("server-recovery"));
  const viewId = store.state.viewOrder[0];
  store.apply({ commandId: "project", command: { type: "project.create", projectId: "project-missing", viewId, root: "/volumes/offline/project", name: "Offline" } });
  store.apply({ commandId: "session", command: { type: "terminal.create", sessionId: "session-interrupted", projectId: "project-missing", createdAt: 10 } });
  store.markInterruptedSessions(99);
  const before = store.state;

  const report = await reportWorkspaceRecovery(before, { exists: async (root) => root !== "/volumes/offline/project" });
  assert.deepEqual(report, {
    serverId: "server-recovery",
    missingRoots: [{ projectId: "project-missing", root: "/volumes/offline/project", available: false }],
    interruptedSessions: [{ sessionId: "session-interrupted", projectId: "project-missing", interruptedAt: 99 }],
  });
  assert.deepEqual(store.state, before, "reporting does not rewrite roots or invent a replacement session");
});

test("workspace recovery reports no gaps when roots exist and sessions are live", async () => {
  const store = new WorkspaceStore(createInitialWorkspace("server-healthy"));
  const viewId = store.state.viewOrder[0];
  store.apply({ commandId: "project", command: { type: "project.create", projectId: "project-healthy", viewId, root: "/workspace/project", name: "Healthy" } });
  const report = await reportWorkspaceRecovery(store.state, { exists: () => true });
  assert.deepEqual(report, { serverId: "server-healthy", missingRoots: [], interruptedSessions: [] });
});
