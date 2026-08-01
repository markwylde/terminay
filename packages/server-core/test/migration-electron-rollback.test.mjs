import assert from "node:assert/strict";
import test from "node:test";
import { MigrationRunner } from "../dist/migration/index.js";

function createBackend({ failSecrets = false, failCommit = false } = {}) {
  let marker;
  const calls = [];
  const backend = {
    async loadMarker() { return marker; },
    async saveMarker(value) { marker = structuredClone(value); },
    async backup() { calls.push("backup"); return "server-backup"; },
    async captureElectronState() { calls.push("capture-electron"); return "electron-backup"; },
    async restoreElectronState(id) { calls.push(["restore-electron", id]); },
    async restoreBackup(id) { calls.push(["restore-backup", id]); },
    async beginServerOnlyMutations() { calls.push("begin-server"); },
    async commitServerOnlyMutations() {
      calls.push(["commit-server", marker?.serverCommitState]);
      if (failCommit) throw new Error("commit outcome unknown");
    },
    async importSettings() { calls.push("settings"); },
    async importMacros() { calls.push("macros"); },
    async importConnectionProfiles() { calls.push("profiles"); },
    async importProjects() { calls.push("projects"); },
    async importRecordings() { calls.push("recordings"); },
    async importSecret() {
      calls.push("secrets");
      if (failSecrets) throw new Error("vault unavailable");
    },
  };
  return { backend, calls, get marker() { return marker; } };
}

test("rollback restores Electron state while the server-only commit boundary is open", async () => {
  const state = createBackend({ failSecrets: true });
  const runner = new MigrationRunner(state.backend, { migrationId: "electron-before-commit", now: () => 100 });

  await assert.rejects(runner.run({ settings: { theme: "dark" }, secrets: { token: "not persisted" } }), /vault unavailable/);
  assert.equal(state.marker.serverCommitState, "uncommitted");
  assert.equal(state.marker.electronStateBackupId, "electron-backup");

  const result = await runner.rollback();
  assert.equal(result.restored, true);
  assert.equal(result.electronRestored, true);
  assert.equal(result.serverOnlyCommitted, false);
  assert.equal(result.backupRecoveryRequired, false);
  assert.deepEqual(state.calls.slice(-2), [["restore-backup", "server-backup"], ["restore-electron", "electron-backup"]]);
  assert.equal(state.marker.serverCommitState, "uncommitted");
});

test("committed migration refuses implicit Electron rollback and exposes explicit backup recovery", async () => {
  const state = createBackend();
  const runner = new MigrationRunner(state.backend, { migrationId: "electron-after-commit", now: () => 200 });

  const result = await runner.run({ settings: { theme: "dark" } });
  assert.equal(result.marker.serverCommitState, "committed");
  assert.equal(result.marker.serverCommitAt, 200);
  assert.equal(state.calls.some((call) => Array.isArray(call) && call[0] === "commit-server"), true);
  await assert.rejects(runner.rollback(), /explicit backup recovery/);
  assert.equal(state.marker.rollbackState, "recovery-required");
  assert.equal(state.calls.some((call) => Array.isArray(call) && call[0] === "restore-electron"), false);

  const recovery = await runner.recoverBackup();
  assert.equal(recovery.recovered, true);
  assert.equal(recovery.serverRestored, true);
  assert.equal(recovery.electronRestored, false);
  assert.equal(recovery.electronStateBackupId, "electron-backup");
  assert.equal(recovery.marker.backupRecoveryAt, 200);
  assert.deepEqual(state.calls.slice(-1), [["restore-backup", "server-backup"]]);
  assert.equal(state.marker.serverCommitState, "unknown");
  assert.equal(state.marker.status, "failed");
  assert.equal(state.marker.rollbackState, "recovery-required");
  assert.equal(state.calls.some((call) => Array.isArray(call) && call[0] === "restore-electron"), false);
});

test("an uncertain server commit fails closed and still offers explicit server backup recovery", async () => {
  const state = createBackend({ failCommit: true });
  const runner = new MigrationRunner(state.backend, { migrationId: "electron-unknown-commit", now: () => 250 });

  await assert.rejects(runner.run({ settings: { theme: "dark" } }), /commit outcome unknown/);
  assert.equal(state.marker.serverCommitState, "unknown");
  assert.equal(state.marker.rollbackState, "recovery-required");
  assert.deepEqual(state.calls.find((call) => Array.isArray(call) && call[0] === "commit-server"), ["commit-server", "unknown"]);
  const restarted = new MigrationRunner(state.backend, { migrationId: "electron-unknown-commit", now: () => 251 });
  await assert.rejects(restarted.run({ settings: { theme: "dark" } }), /recover the backup before retrying/);
  await assert.rejects(runner.rollback(), /explicit backup recovery/);
  assert.equal(state.calls.some((call) => Array.isArray(call) && call[0] === "restore-electron"), false);

  const recovery = await runner.recoverBackup();
  assert.equal(recovery.serverRestored, true);
  assert.equal(recovery.electronRestored, false);
  assert.deepEqual(state.calls.slice(-1), [["restore-backup", "server-backup"]]);
});

test("backup recovery cannot be invoked before the server-only commit boundary", async () => {
  const state = createBackend({ failSecrets: true });
  const runner = new MigrationRunner(state.backend, { migrationId: "electron-recovery-order", now: () => 300 });
  await assert.rejects(runner.run({ secrets: { token: "not persisted" } }), /vault unavailable/);
  await assert.rejects(runner.recoverBackup(), /only after server-only commit/);
  assert.equal(state.calls.some((call) => Array.isArray(call) && call[0] === "restore-backup"), false);
});

test("legacy completed markers fail closed instead of restoring Electron state", async () => {
  const state = createBackend();
  const { commitServerOnlyMutations: _commit, ...legacyBackend } = state.backend;
  const runner = new MigrationRunner(legacyBackend, { migrationId: "electron-legacy-complete", now: () => 400 });
  await runner.run({ settings: { theme: "dark" } });
  await assert.rejects(runner.rollback(), /explicit backup recovery/);
  assert.equal(state.calls.some((call) => Array.isArray(call) && call[0] === "restore-electron"), false);
});
