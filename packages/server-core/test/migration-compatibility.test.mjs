import test from "node:test";
import assert from "node:assert/strict";
import {
  CURRENT_MANAGER_ORIGIN,
  CompatibilityError,
  assertCompatibleVersions,
  checkCompatibilityMatrix,
  sanitizeManagerProfiles,
  separateConnectionProfilesFromTrust,
  inspectLegacyMigration,
  MigrationRunner,
} from "../dist/migration/index.js";

test("compatibility matrix reports deterministic minimum-version errors", () => {
  const requirements = {
    desktop: { minimum: "1.4.0" },
    server: { minimum: "2.0.0", maximum: "2.5.0" },
    ui: { minimum: "1.0.0" },
  };
  const failures = checkCompatibilityMatrix({ desktop: "1.3.9", server: "2.6.0", ui: "1.0.0" }, requirements);
  assert.deepEqual(failures, [
    { component: "desktop", actual: "1.3.9", minimum: "1.4.0", code: "below_minimum" },
    { component: "server", actual: "2.6.0", minimum: "2.0.0", maximum: "2.5.0", code: "above_maximum" },
  ]);
  assert.throws(() => assertCompatibleVersions({ desktop: "1.3.9" }, requirements), (error) => {
    assert.ok(error instanceof CompatibilityError);
    assert.equal(error.code, "below_minimum");
    assert.equal(error.component, "desktop");
    assert.match(error.message, /desktop version 1\.3\.9; requires >= 1\.4\.0/);
    assert.equal(error.message.includes("secret"), false);
    return true;
  });
  assert.throws(() => assertCompatibleVersions({}, { signaling: { minimum: "1.0.0" } }), /signaling version is missing/);
  assert.throws(() => checkCompatibilityMatrix({ desktop: "not-a-version" }, requirements), /desktop version is invalid/);
});

test("migration runner rejects an incompatible source before creating a backup", async () => {
  const state = resumableBackend();
  const runner = new MigrationRunner(state.backend, {
    migrationId: "compatibility-1",
    compatibilityRequirements: {
      desktop: { minimum: "1.0.0" },
      server: { minimum: "2.0.0" },
      ui: { minimum: "1.0.0" },
      bootstrap: { minimum: "1.0.0" },
      signaling: { minimum: "1.0.0" },
    },
  });
  await assert.rejects(runner.run({ desktopVersion: "0.9.9", serverVersion: "2.0.0", uiVersion: "1.0.0", bootstrapVersion: "1.0.0", signalingVersion: "1.0.0" }), (error) => {
    assert.equal(error.code, "incompatible_version");
    assert.match(error.message, /desktop version 0\.9\.9; requires >= 1\.0\.0/);
    return true;
  });
  assert.equal(state.backups.length, 0);
  assert.equal(state.marker, undefined);
});

test("manager profile migration redirects only sanitized metadata and preserves session origins", () => {
  const source = {
    profiles: [{
      id: "remote-prod",
      serverId: "server-prod",
      origin: "https://session-prod.terminay.com",
      label: "Production",
      kind: "remote",
      fingerprint: "sha256:prod",
      pairingFragment: "pairing-secret",
      reconnectGrant: "grant-secret",
      devicePrivateKey: "private-key",
    }],
  };
  const migration = sanitizeManagerProfiles(source, { sourceOrigin: "https://app.terminay.com" });
  assert.equal(migration.sourceOrigin, "https://app.terminay.com");
  assert.equal(migration.destinationOrigin, CURRENT_MANAGER_ORIGIN);
  assert.deepEqual(migration.profiles, [{
    id: "remote-prod",
    serverId: "server-prod",
    origin: "https://session-prod.terminay.com",
    label: "Production",
    kind: "remote",
    fingerprint: "sha256:prod",
  }]);
  assert.equal(JSON.stringify(migration).includes("pairing-secret"), false);
  assert.equal(JSON.stringify(migration).includes("grant-secret"), false);
  assert.equal(JSON.stringify(migration).includes("private-key"), false);
  assert.deepEqual(source.profiles[0].pairingFragment, "pairing-secret");
  assert.throws(() => sanitizeManagerProfiles(source, { sourceOrigin: "https://evil.example" }), /manager origin is not supported/);
  assert.throws(() => sanitizeManagerProfiles({ profiles: [{ ...source.profiles[0], origin: "https://session-prod.terminay.com/path#pairing" }] }, { sourceOrigin: "https://app.terminay.com" }), /without path, query, or fragment/);
  assert.throws(() => sanitizeManagerProfiles({ profiles: [{ ...source.profiles[0], origin: "https://user:password@session-prod.terminay.com" }] }, { sourceOrigin: "https://app.terminay.com" }), /credentials/);
  assert.throws(() => sanitizeManagerProfiles({ profiles: [{ ...source.profiles[0], origin: "http://remote.example" }] }, { sourceOrigin: "https://app.terminay.com" }), /HTTPS/);
});

test("connection profile and server trust migration remain separate and renderer layouts are explicit", async () => {
  const state = separateConnectionProfilesFromTrust({
    profiles: [{ id: "remote-prod", serverId: "server-prod", origin: "https://session-prod.terminay.com", label: "Production", kind: "remote", fingerprint: "sha256:profile" }],
    serverTrust: [{ serverId: "server-prod", origin: "https://session-prod.terminay.com", fingerprint: "sha256:trust", deviceKey: "private-device-key", reconnectGrant: "grant-secret" }],
  }, { sourceOrigin: "https://app.terminay.com" });
  assert.equal(state.manager.destinationOrigin, CURRENT_MANAGER_ORIGIN);
  assert.deepEqual(state.manager.profiles, [{ id: "remote-prod", serverId: "server-prod", origin: "https://session-prod.terminay.com", label: "Production", kind: "remote", fingerprint: "sha256:profile" }]);
  assert.deepEqual(state.serverTrust, [{ serverId: "server-prod", origin: "https://session-prod.terminay.com", fingerprint: "sha256:trust" }]);
  assert.equal(JSON.stringify(state).includes("private-device-key"), false);
  assert.equal(JSON.stringify(state).includes("grant-secret"), false);
  assert.equal("serverTrust" in state.manager, false);

  const inventory = await inspectLegacyMigration({ profiles: [{ id: "remote-prod" }], renderer: { panels: ["terminal"] } }, { pathProbe: () => "missing" });
  assert.deepEqual(inventory.rendererLayout, { recoverable: false, reason: "renderer-only-layout-not-persisted" });
});

function resumableBackend() {
  let marker;
  let failSecrets = true;
  const backups = [];
  const restores = [];
  const imported = [];
  const backend = {
    async loadMarker() { return marker; },
    async saveMarker(value) { marker = structuredClone(value); },
    async backup(value) { backups.push(structuredClone(value)); return "backup-rollback"; },
    async restoreBackup(id) { restores.push(id); imported.length = 0; },
    async importSettings(value) { imported.push(["settings", value]); },
    async importMacros(value) { imported.push(["macros", value]); },
    async importConnectionProfiles(value) { imported.push(["profiles", value]); },
    async importProjects(value) { imported.push(["projects", value]); },
    async importRecordings(value) { imported.push(["recordings", value]); },
    async importSecret(id, value) { if (failSecrets) throw new Error("vault unavailable"); imported.push(["secret", id, value]); },
  };
  return { backend, backups, restores, imported, setFailSecrets(value) { failSecrets = value; }, get marker() { return marker; } };
}

test("failed migration exposes an opaque rollback marker and resumes after explicit restore", async () => {
  const state = resumableBackend();
  const runner = new MigrationRunner(state.backend, { migrationId: "rollback-1", now: () => 42 });
  const source = { settings: { shell: { program: "/bin/zsh" } }, secrets: { token: "must-not-persist" } };
  await assert.rejects(runner.run(source), /vault unavailable/);
  assert.equal(state.marker.status, "failed");
  assert.equal(state.marker.rollbackState, "available");
  assert.equal(state.marker.backupId, "backup-rollback");
  assert.equal(JSON.stringify(state.marker).includes("must-not-persist"), false);
  const rollback = await runner.rollback();
  assert.equal(rollback.restored, true);
  assert.equal(rollback.marker.status, "pending");
  assert.deepEqual(rollback.marker.completedSteps, []);
  assert.equal(rollback.marker.rollbackState, "restored");
  assert.equal(rollback.marker.rollbackAt, 42);
  assert.deepEqual(state.restores, ["backup-rollback"]);
  state.setFailSecrets(false);
  const result = await runner.run(source);
  assert.equal(result.resumed, true);
  assert.equal(result.marker.status, "complete");
  assert.equal(state.backups.length, 1);
  assert.equal(JSON.stringify(state.marker).includes("must-not-persist"), false);
});

test("rollback remains explicitly unavailable when a backend has no restore boundary", async () => {
  const state = resumableBackend();
  const { restoreBackup: _ignored, ...withoutRestore } = state.backend;
  const runner = new MigrationRunner(withoutRestore, { migrationId: "rollback-2" });
  await assert.rejects(runner.run({ secrets: { token: "secret" } }), /vault unavailable/);
  await assert.rejects(runner.rollback(), /does not support rollback/);
  assert.equal(state.marker.status, "failed");
  assert.equal(state.marker.rollbackState, "available");
});
