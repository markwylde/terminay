import assert from "node:assert/strict";
import test from "node:test";
import {
  CODEX_MANAGED_HOOK_EVENTS,
  CLAUDE_CODE_MANAGED_HOOK_EVENTS,
  MANAGED_HOOK_MARKER,
  buildManagedHookScript,
  claudeCodeManagedHookReconciler,
  codexManagedHookReconciler,
  createManagedHookReconcilers,
  isManagedCommand,
} from "../dist/activity/index.js";

function memoryFileSystem(initial = {}) {
  const files = new Map(Object.entries(initial));
  const modes = new Map();
  const missing = (path) => Object.assign(new Error(`missing ${path}`), { code: "ENOENT" });
  return {
    files,
    modes,
    async readFile(path) {
      if (!files.has(path)) throw missing(path);
      return files.get(path);
    },
    async writeFile(path, content) { files.set(path, content); },
    async mkdir() {},
    async rename(from, to) {
      if (!files.has(from)) throw missing(from);
      files.set(to, files.get(from));
      files.delete(from);
    },
    async chmod(path, mode) { modes.set(path, mode); },
    async remove(path) { files.delete(path); },
  };
}

function pathFor(provider) {
  return provider === "codex" ? "/fixture home/.codex/hooks.json" : "/fixture home/.claude/settings.json";
}

test("server-core reconciles Codex and Claude hooks without Electron path assumptions", async () => {
  const fs = memoryFileSystem({
    [pathFor("codex")]: JSON.stringify({
      userSetting: "preserve-me",
      hooks: {
        SessionStart: [{ matcher: "user", hooks: [{ type: "command", command: "user-session-hook" }] }],
      },
    }),
    [pathFor("claude-code")]: JSON.stringify({
      custom: { nested: true },
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "user-stop-hook" }] }],
      },
    }),
  });
  const options = { homeDir: "/fixture home", scriptDir: "/fixture scripts", fileSystem: fs };
  const codex = await codexManagedHookReconciler.install(options);
  const claude = await claudeCodeManagedHookReconciler.install(options);
  assert.equal(codex.state, "installed");
  assert.equal(claude.state, "installed");
  assert.equal(codex.installedEvents.length, CODEX_MANAGED_HOOK_EVENTS.length);
  assert.equal(claude.installedEvents.length, CLAUDE_CODE_MANAGED_HOOK_EVENTS.length);

  const codexConfig = JSON.parse(fs.files.get(pathFor("codex")));
  const claudeConfig = JSON.parse(fs.files.get(pathFor("claude-code")));
  assert.equal(codexConfig.userSetting, "preserve-me");
  assert.deepEqual(codexConfig.hooks.SessionStart[0].hooks[0].command, "user-session-hook");
  assert.deepEqual(claudeConfig.custom, { nested: true });
  assert.equal(claudeConfig.hooks.Stop.some((definition) => definition.hooks?.some((hook) => hook.command === "user-stop-hook")), true);
  assert.equal(JSON.stringify(codexConfig).includes("TERMINAY_AGENT_HOOK_TOKEN"), false);
  assert.equal(JSON.stringify(claudeConfig).includes("TERMINAY_AGENT_HOOK_TOKEN"), false);

  const second = await codexManagedHookReconciler.install(options);
  assert.equal(second.state, "installed");
  const repeated = JSON.parse(fs.files.get(pathFor("codex")));
  for (const event of CODEX_MANAGED_HOOK_EVENTS) {
    const managed = repeated.hooks[event.eventName].flatMap((definition) => definition.hooks ?? []).filter((hook) => isManagedCommand(hook.command));
    assert.equal(managed.length, 1, event.eventName);
  }
  assert.equal(fs.modes.get(codex.scriptPath), 0o700);
  assert.equal(fs.modes.get(claude.scriptPath), 0o700);
});

test("managed hook uninstall is scoped, idempotent, and fails closed on malformed config", async () => {
  const codexPath = pathFor("codex");
  const fs = memoryFileSystem({
    [codexPath]: JSON.stringify({
      unrelated: true,
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: `${MANAGED_HOOK_MARKER} /bin/sh '/fixture scripts/hook' codex` }] },
          { hooks: [{ type: "command", command: "user-hook" }] },
        ],
      },
    }),
  });
  const options = { homeDir: "/fixture home", scriptDir: "/fixture scripts", fileSystem: fs };
  const status = await codexManagedHookReconciler.uninstall(options);
  assert.equal(status.state, "not-installed");
  const config = JSON.parse(fs.files.get(codexPath));
  assert.equal(config.unrelated, true);
  assert.deepEqual(config.hooks.SessionStart, [{ hooks: [{ type: "command", command: "user-hook" }] }]);
  assert.equal(fs.files.has(status.scriptPath), false);
  assert.equal((await codexManagedHookReconciler.uninstall(options)).state, "not-installed");

  const malformedFs = memoryFileSystem({ [codexPath]: "not-json" });
  const malformed = await codexManagedHookReconciler.install({ ...options, fileSystem: malformedFs });
  assert.equal(malformed.state, "error");
  assert.equal(malformedFs.files.get(codexPath), "not-json");
  assert.equal(malformedFs.files.size, 1);
});

test("managed script is bounded, environment-scoped, and never persists credentials", () => {
  const script = buildManagedHookScript();
  assert.match(script, /TERMINAY_SESSION_ID/);
  assert.match(script, /TERMINAY_AGENT_HOOK_ENDPOINT/);
  assert.match(script, /TERMINAY_AGENT_HOOK_TOKEN/);
  assert.match(script, /--max-time 1\.5/);
  assert.match(script, /localhost/);
  assert.doesNotMatch(script, /service-secret|raw-provider-token|fixture-token/i);
  assert.deepEqual(Object.keys(createManagedHookReconcilers()).sort(), ["claude-code", "codex"]);
});
