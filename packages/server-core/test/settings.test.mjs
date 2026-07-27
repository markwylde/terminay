import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SERVER_SETTINGS,
  ServerSettingsRepository,
  classifySetting,
  migrateServerSettings,
  normalizeSettingsAndSecrets,
  partitionSettings,
  resolveServerSettingsForDevice,
} from "../dist/settings/index.js";

test("settings classification keeps server state separate from host, device, and transient state", () => {
  assert.equal(classifySetting("shell.program"), "server");
  assert.equal(classifySetting("theme.background"), "connection-host");
  assert.equal(classifySetting("dictation.microphoneDeviceId"), "device-override");
  assert.equal(classifySetting("window.bounds"), "transient");
  const partitioned = partitionSettings({ shell: { program: "/bin/zsh" }, theme: { background: "red" }, dictation: { microphoneDeviceId: "mic" }, window: { bounds: [1, 2] } });
  assert.equal(partitioned.server.shell.program, "/bin/zsh");
  assert.equal(partitioned.connectionHost.theme.background, "red");
  assert.equal(partitioned.deviceOverrides["dictation.microphoneDeviceId"], "mic");
  assert.equal(partitioned.transient.window.bounds[0], 1);
});

test("legacy settings normalize to defaults and expose metadata-only secret references", () => {
  const migrated = migrateServerSettings({ shell: { startupMode: "login" }, openAiApiKey: "do-not-return" });
  assert.equal(migrated.schemaVersion, 1);
  assert.equal(migrated.settings.shell.startupMode, "login");
  assert.equal(migrated.settings.shell.program, DEFAULT_SERVER_SETTINGS.shell.program);
  assert.equal(migrated.secretReferences.openAiApiKey.configured, true);
  assert.equal("value" in migrated.secretReferences.openAiApiKey, false);
  assert.equal(JSON.stringify(migrated).includes("do-not-return"), false);
  assert.deepEqual(migrateServerSettings(migrated), migrated);
});

test("two clients get revision conflicts and reset is explicit", async () => {
  let persisted;
  const repository = new ServerSettingsRepository({ async load() { return persisted; }, async commit(state) { persisted = state; } });
  const first = await repository.load();
  const changed = await repository.set("shell.program", "/bin/fish", first.revision);
  assert.equal(changed.ok, true);
  const stale = await repository.set("shell.extraArgs", "--login", first.revision);
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.conflict.currentRevision, 1);
  const reset = await repository.reset({ expectedRevision: 1 });
  assert.equal(reset.ok, true);
  assert.equal(repository.settings.shell.program, DEFAULT_SERVER_SETTINGS.shell.program);
});

test("non-server writes are rejected before persistence", async () => {
  const repository = new ServerSettingsRepository({ async load() { return undefined; }, async commit() {} });
  await repository.load();
  await assert.rejects(repository.set("theme.background", "#fff"), /connection-host/);
  await assert.rejects(repository.set("dictation.microphoneDeviceId", "mic"), /device-override/);
});

test("normalization does not mutate input", () => {
  const input = { settings: { shell: { program: "/bin/zsh" } }, secretReferences: { key: { configured: true, value: "hidden" } } };
  const copy = structuredClone(input);
  const result = normalizeSettingsAndSecrets(input);
  assert.deepEqual(input, copy);
  assert.equal(result.secretReferences.key.configured, true);
  assert.equal("value" in result.secretReferences.key, false);
});

test("device overrides win only in an effective read and never mutate shared server settings", () => {
  const server = {
    dictation: { enabled: true, microphoneDeviceId: "server-mic" },
    shell: { program: "/bin/zsh" },
  };
  const overrides = {
    "dictation.microphoneDeviceId": "device-mic",
    "shell.program": "/tmp/attacker-shell",
    "window": { bounds: [1, 2] },
  };
  const effective = resolveServerSettingsForDevice(server, overrides);
  assert.equal(effective.dictation.microphoneDeviceId, "device-mic");
  assert.equal(effective.shell.program, "/bin/zsh");
  assert.equal("window" in effective, false);
  assert.equal(server.dictation.microphoneDeviceId, "server-mic");
});
