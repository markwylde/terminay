import assert from "node:assert/strict";
import test from "node:test";
import { createInitialWorkspace, migrateWorkspaceState, WorkspaceStore, WORKSPACE_SCHEMA_VERSION } from "../dist/index.js";

function storeWithProject() {
  const store = new WorkspaceStore(createInitialWorkspace("server"));
  const viewId = store.state.viewOrder[0];
  store.apply({ commandId: "create", command: { type: "project.create", projectId: "project", viewId, root: "/tmp/project", name: "Project" } });
  return store;
}

test("project shell profile defaults are stable revisioned workspace state", () => {
  const store = storeWithProject();
  const set = store.apply({ commandId: "set", expectedRevision: 1, command: { type: "project.shellProfile.set", projectId: "project", profileId: "profile:zsh" } });
  assert.equal(set.ok, true);
  assert.equal(store.state.projects.project.defaultShellProfileId, "profile:zsh");
  const replay = store.apply({ commandId: "set", expectedRevision: 1, command: { type: "project.shellProfile.set", projectId: "project", profileId: "ignored" } });
  assert.deepEqual(replay, set);
  const clear = store.apply({ commandId: "clear", command: { type: "project.shellProfile.clear", projectId: "project" } });
  assert.equal(clear.ok, true);
  assert.equal(store.state.projects.project.defaultShellProfileId, undefined);
});

test("bulk replacement updates all matching project defaults in one workspace revision", () => {
  const store = storeWithProject();
  store.apply({ commandId: "set", command: { type: "project.shellProfile.set", projectId: "project", profileId: "old" } });
  const before = store.state.revision;
  const replaced = store.apply({ commandId: "replace", command: { type: "project.shellProfile.replace", fromProfileId: "old", toProfileId: "new" } });
  assert.equal(replaced.ok, true);
  assert.equal(store.state.revision, before + 1);
  assert.equal(store.state.projects.project.defaultShellProfileId, "new");
});

test("v1 workspace snapshots migrate without inventing project defaults", () => {
  const current = storeWithProject().state;
  const migrated = migrateWorkspaceState({ ...current, schemaVersion: 1 }, "server");
  assert.equal(migrated.schemaVersion, WORKSPACE_SCHEMA_VERSION);
  assert.equal(migrated.projects.project.defaultShellProfileId, undefined);
});

