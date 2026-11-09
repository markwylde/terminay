import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SERVER_SETTINGS,
  SETTING_AUTHORITY,
  SETTINGS_SCHEMA_VERSION,
  ServerSettingsRepository,
  classifySetting,
  migrateServerSettings,
  normalizeSettingsAndSecrets,
  partitionSettings,
  resolveServerSettingsForDevice,
  serializeServerSettings,
} from "../dist/settings/index.js";

test("every registered setting authority is classified and serialized at its boundary", () => {
  for (const [path, authority] of Object.entries(SETTING_AUTHORITY)) {
    assert.equal(classifySetting(path), authority, path);
  }

  const input = Object.fromEntries(Object.keys(SETTING_AUTHORITY).map((path) => [path, { sentinel: path }]));
  const serialized = serializeServerSettings(input);
  for (const [path, authority] of Object.entries(SETTING_AUTHORITY)) {
    if (authority === "server") assert.equal(path in serialized, true, path);
    else assert.equal(path in serialized, false, path);
  }
});

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
  assert.equal(migrated.schemaVersion, SETTINGS_SCHEMA_VERSION);
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

test("repository backs up the exact legacy source before migration and retries deterministically", async () => {
  const legacy = { shell: { program: "/bin/zsh", startupMode: "login", extraArgs: '"two words"' }, scrollback: 1234 };
  const calls = [];
  let persisted = structuredClone(legacy);
  const repository = new ServerSettingsRepository({
    async load() { return structuredClone(persisted); },
    async backup(source) { calls.push(["backup", structuredClone(source)]); },
    async commit(state) { calls.push(["commit", state.schemaVersion]); persisted = structuredClone(state); },
    async audit(outcome) { calls.push(["audit", structuredClone(outcome)]); },
  });
  const migrated = await repository.load();
  assert.deepEqual(calls[0], ["backup", legacy]);
  assert.deepEqual(calls[1], ["commit", SETTINGS_SCHEMA_VERSION]);
  assert.deepEqual(calls[2], ["audit", { action: "migration", ok: true, fromSchema: null, toSchema: SETTINGS_SCHEMA_VERSION }]);
  assert.deepEqual(migrateServerSettings(migrated), migrated);
});

test("persisted settings migration refuses to overwrite without recoverable backup support", async () => {
  const repository = new ServerSettingsRepository({ async load() { return { shell: { program: "/bin/zsh" } }; }, async commit() { assert.fail("must not commit"); } });
  await assert.rejects(repository.load(), /requires recoverable backup/);
});

test("per-harness agent switches keep boolean entries keyed by namespaced harness", () => {
  const { settings } = normalizeSettingsAndSecrets({
    agentIntegration: {
      enabled: true,
      harnesses: {
        "com.terminay.builtin-agents/agents/grok": false,
        "com.terminay.builtin-agents/agents/codex": true,
        "com.terminay.builtin-agents/agents/bad": "off",
      },
    },
  });
  assert.deepEqual(settings.agentIntegration, {
    enabled: true,
    harnesses: {
      "com.terminay.builtin-agents/agents/grok": false,
      "com.terminay.builtin-agents/agents/codex": true,
    },
  });
  assert.deepEqual(DEFAULT_SERVER_SETTINGS.agentIntegration, { enabled: true, harnesses: {} });
});

test("convertEol defaults off", () => {
  assert.equal(DEFAULT_SERVER_SETTINGS.convertEol, false);
  assert.equal(SETTINGS_SCHEMA_VERSION, 3);
});

test("loading a pre-v3 snapshot resets the former convertEol default once", () => {
  const v2 = (settings) => ({ schemaVersion: 2, revision: 7, settings: { shellProfiles: DEFAULT_SERVER_SETTINGS.shellProfiles, ...settings }, secretReferences: {} });
  assert.equal(migrateServerSettings(v2({ convertEol: true })).settings.convertEol, false);
  assert.equal(migrateServerSettings(v2({ convertEol: false })).settings.convertEol, false);
  assert.equal(migrateServerSettings(v2({})).settings.convertEol, false);
  assert.equal(migrateServerSettings({ convertEol: true, scrollback: 2000 }).settings.convertEol, false);
  const v3 = migrateServerSettings({ ...v2({ convertEol: true }), schemaVersion: 3 });
  assert.equal(v3.settings.convertEol, true);
  assert.deepEqual(migrateServerSettings(v3), v3);
});

test("settings commands never apply the convertEol migration", () => {
  assert.equal(normalizeSettingsAndSecrets({ convertEol: true }).settings.convertEol, true);
  assert.equal(normalizeSettingsAndSecrets({ settings: { convertEol: true } }).settings.convertEol, true);
});

test("repository migrates a v2 convertEol default and keeps a later opt-in across changes and reloads", async () => {
  let persisted = { schemaVersion: 2, revision: 4, cursor: "4", settings: { shellProfiles: DEFAULT_SERVER_SETTINGS.shellProfiles, convertEol: true }, secretReferences: {} };
  const backups = [];
  const backend = {
    async load() { return structuredClone(persisted); },
    async backup(source) { backups.push(structuredClone(source)); },
    async commit(state) { persisted = structuredClone(state); },
  };
  const first = new ServerSettingsRepository(backend);
  const loaded = await first.load();
  assert.equal(backups.length, 1);
  assert.equal(backups[0].settings.convertEol, true);
  assert.equal(persisted.schemaVersion, 3);
  assert.equal(loaded.settings.convertEol, false);

  assert.equal((await first.set("convertEol", true, loaded.revision)).ok, true);
  assert.equal((await first.set("scrollback", 4321, first.revision)).ok, true);
  assert.equal(first.settings.convertEol, true);

  const reloaded = await new ServerSettingsRepository(backend).load();
  assert.equal(reloaded.settings.convertEol, true);
  assert.equal(reloaded.settings.scrollback, 4321);
  assert.equal(backups.length, 1);
});
