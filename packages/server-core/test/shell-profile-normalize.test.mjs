import assert from "node:assert/strict";
import test from "node:test";
import {
  migrateServerSettings,
  normalizeShellProfilesSettings,
  parseLegacyShellArguments,
  SETTINGS_SCHEMA_VERSION,
} from "../dist/index.js";

const profile = (overrides = {}) => ({
  id: "profile:zsh",
  name: "Zsh",
  target: { kind: "executable", executable: "/bin/zsh" },
  args: ["--no-rcs", "two words"],
  startupMode: "login",
  environment: { EDITOR: "vim", OPTIONAL: null },
  ...overrides,
});

test("shell profile normalization preserves argv and null environment removal", () => {
  const settings = normalizeShellProfilesSettings({
    defaultProfileId: "profile:zsh",
    cwdPolicy: "current",
    profiles: [profile()],
    order: ["profile:zsh"],
  });
  assert.deepEqual(settings.profiles[0].args, ["--no-rcs", "two words"]);
  assert.deepEqual(settings.profiles[0].environment, { EDITOR: "vim", OPTIONAL: null });
});

test("shell profile normalization enforces identity, references, bounds, and protected fields", () => {
  assert.throws(() => normalizeShellProfilesSettings({ defaultProfileId: "missing", profiles: [], order: [] }), /does not exist/);
  assert.throws(() => normalizeShellProfilesSettings({ profiles: [profile(), profile()], order: ["profile:zsh", "profile:zsh"] }), /ids must be unique/);
  assert.throws(() => normalizeShellProfilesSettings({ profiles: [profile({ id: "a" }), profile({ id: "b", name: "zSH" })], order: ["a", "b"] }), /names must be unique/);
  assert.throws(() => normalizeShellProfilesSettings({ profiles: [profile({ environment: { TERMINAY_CONTROL_TOKEN: "x" } })], order: ["profile:zsh"] }), /server protected/);
  assert.throws(() => normalizeShellProfilesSettings({ profiles: [profile({ environment: { API_TOKEN: "x" } })], order: ["profile:zsh"] }), /secret-like/);
  assert.throws(() => normalizeShellProfilesSettings({ profiles: [profile({ args: ["-c", "echo unsafe"] })], order: ["profile:zsh"] }), /command arguments/);
  assert.throws(() => normalizeShellProfilesSettings({ profiles: [profile({ target: { kind: "wsl", distribution: "Ubuntu", shellPath: "bin/zsh" } })], order: ["profile:zsh"] }), /must be absolute/);
  assert.throws(() => normalizeShellProfilesSettings({ profiles: Array.from({ length: 65 }, (_, index) => profile({ id: `p:${index}`, name: `P ${index}` })), order: [] }), /at most 64/);
});

test("legacy argument parsing preserves quote boundaries without evaluating input", () => {
  assert.deepEqual(parseLegacyShellArguments('--flag "two words" escaped\\ value'), {
    args: ["--flag", "two words", "escaped value"], requiresReview: false,
  });
  assert.deepEqual(parseLegacyShellArguments('"unterminated'), { args: ['"unterminated'], requiresReview: true });
  assert.equal(parseLegacyShellArguments('-c "echo hello"').requiresReview, true);
});

test("legacy shell migration is deterministic, versioned, and idempotent", () => {
  const migrated = migrateServerSettings({ shell: { program: "/bin/zsh", startupMode: "login", extraArgs: '--flag "two words"' } });
  assert.equal(migrated.schemaVersion, SETTINGS_SCHEMA_VERSION);
  assert.equal(migrated.settings.shellProfiles.defaultProfileId, "migrated-shell");
  assert.deepEqual(migrated.settings.shellProfiles.profiles[0].args, ["--flag", "two words"]);
  assert.deepEqual(migrateServerSettings(migrated), migrated);

  const defaults = migrateServerSettings({ shell: { program: "", startupMode: "auto", extraArgs: "" } });
  assert.equal(defaults.settings.shellProfiles.defaultProfileId, "system");
  assert.deepEqual(defaults.settings.shellProfiles.profiles, []);

  const review = migrateServerSettings({ shell: { program: "/bin/zsh", startupMode: "auto", extraArgs: '"unterminated' } });
  assert.equal(review.settings.shellProfiles.profiles[0].requiresReview, true);
});

