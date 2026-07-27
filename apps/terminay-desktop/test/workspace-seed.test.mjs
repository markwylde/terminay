import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceSeedCommands, seedLegacyWorkspace } from "../dist/compatibility/index.js";

const existing = {
  serverId: "server-seed",
  revision: 4,
  views: {
    "server-seed:view:default": { id: "server-seed:view:default" },
    "view-secondary": { id: "view-secondary" },
  },
  projects: {
    "project-existing": { id: "project-existing", viewId: "server-seed:view:default", name: "Old name", root: "/repo/existing" },
  },
  panels: {},
  terminalSessions: {},
};

test("legacy renderer state becomes bounded canonical commands and ignores window authority", () => {
  const legacy = {
    serverId: "server-seed",
    webContentsId: 42,
    nativeWindowId: "window-renderer-only",
    views: [{ id: "view-secondary", name: "Secondary" }],
    projects: [{
      id: "project-existing",
      root: "/repo/existing",
      name: "Renamed",
      viewId: "view-secondary",
      panels: [{ id: "panel-terminal", type: "terminal", sessionId: "session-terminal", createdAt: 7, webContentsId: 42 }],
    }],
    terminalSessions: [{ id: "session-terminal", projectId: "project-existing", status: "running", createdAt: 7 }],
  };
  const { commands, skippedInterruptedSessions } = buildWorkspaceSeedCommands(legacy, existing);
  assert.deepEqual(skippedInterruptedSessions, []);
  assert.deepEqual(commands.map((command) => command.type), ["project.move", "project.rename", "terminal.create", "panel.create", "panel.reorder"]);
  assert.deepEqual(commands[0], { type: "project.move", projectId: "project-existing", targetViewId: "view-secondary" });
  assert.equal(JSON.stringify(commands).includes("webContentsId"), false);
  assert.equal(JSON.stringify(commands).includes("nativeWindowId"), false);
});

test("seedLegacyWorkspace commits expected-revision commands and does not resurrect interrupted sessions", async () => {
  const calls = [];
  const legacy = {
    serverId: "server-seed",
    projects: [{
      id: "project-new",
      root: "/repo/new",
      name: "New",
      panels: [{ id: "panel-interrupted", type: "terminal", sessionId: "session-interrupted", createdAt: 8 }],
    }],
    terminalSessions: [{ id: "session-interrupted", projectId: "project-new", status: "interrupted", createdAt: 8 }],
  };
  const result = await seedLegacyWorkspace({
    async snapshot() { return { ...existing, revision: 0, projects: {}, panels: {}, terminalSessions: {} }; },
    async command(command, options) { calls.push([command, options]); return { revision: (options.expectedRevision ?? 0) + 1 }; },
  }, legacy);
  assert.deepEqual(result.skippedInterruptedSessions, ["session-interrupted"]);
  assert.equal(result.committed, 1, "only the project seed is committed");
  assert.deepEqual(calls.map(([command]) => command.type), ["project.create"]);
  assert.deepEqual(calls.map(([, options]) => options.expectedRevision), [0]);
  assert.equal(result.finalRevision, 1);
});
