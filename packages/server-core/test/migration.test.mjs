import test from "node:test";
import assert from "node:assert/strict";
import { MigrationRunner } from "../dist/migration/index.js";

function backend({ failSecrets = false } = {}) {
  let marker;
  const backups = [];
  const imported = [];
  return {
    backend: {
      async loadMarker() { return marker; },
      async saveMarker(value) { marker = structuredClone(value); },
      async backup(value) { backups.push(structuredClone(value)); return "backup-1"; },
      async importSettings(value) { imported.push(["settings", value]); },
      async importMacros(value) { imported.push(["macros", value]); },
      async importConnectionProfiles(value) { imported.push(["profiles", value]); },
      async importProjects(value) { imported.push(["projects", value]); },
      async importRecordings(value) { imported.push(["recordings", value]); },
      async importSecret(id, value) { if (failSecrets) throw new Error("vault unavailable"); imported.push(["secret", id, value]); },
    },
    get marker() { return marker; },
    backups,
    imported,
  };
}

test("migration backs up redacted metadata, resumes, and completes idempotently", async () => {
  const state = backend();
  const runner = new MigrationRunner(state.backend, { migrationId: "import-1", sourceSchemaVersion: 0, now: () => 10 });
  const source = { serverId: "srv", settings: { shell: { program: "/bin/zsh" } }, secrets: { apiToken: "dont-persist" }, recordings: { count: 2 } };
  const result = await runner.run(source);
  assert.equal(result.marker.status, "complete");
  assert.equal(state.backups.length, 1);
  assert.equal(JSON.stringify(state.backups[0]).includes("dont-persist"), false);
  assert.equal(state.imported.filter(([kind]) => kind === "secret").length, 1);
  const again = await runner.run(source);
  assert.equal(again.resumed, true);
  assert.equal(state.backups.length, 1);
});

test("failed migration leaves a resumable marker without persisting secret material", async () => {
  const state = backend({ failSecrets: true });
  const runner = new MigrationRunner(state.backend, { migrationId: "import-2", now: () => 20 });
  await assert.rejects(runner.run({ secrets: { password: "plaintext" } }), /vault unavailable/);
  assert.equal(state.marker.status, "failed");
  assert.equal(state.marker.failedStep, "secrets");
  assert.equal(JSON.stringify(state.marker).includes("plaintext"), false);
});

test("server identity collisions fail before backup or import", async () => {
  const state = backend();
  const runner = new MigrationRunner(state.backend, { migrationId: "import-3", expectedServerId: "srv-current" });
  await assert.rejects(runner.run({ serverId: "srv-other" }), /different server identity/);
  assert.equal(state.backups.length, 0);
});
