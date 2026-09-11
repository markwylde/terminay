import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LanguageSessionRuntime } from "../dist/extensions/languageSessionRuntime.js";
import { LanguageSessionManager } from "../dist/index.js";

const STUB = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "stub-language-server.mjs");

function contribution(id = "stub") {
  return { id, displayName: "Stub", languageIds: ["typescript"], fileExtensions: [".ts"] };
}

/**
 * The real child-side runtime behind the manager's bridge, so a start failure
 * travels the path it travels in production: spawn, initialize, exit.
 */
function harness(stubArgs, options = {}) {
  const exits = [];
  const spawns = [];
  const exitListeners = new Set();
  const runtime = new LanguageSessionRuntime({
    onDiagnostics: () => undefined,
    onSessionExit: (exit) => {
      exits.push(exit);
      for (const listener of exitListeners) listener({ ...exit, extensionId: "example.language" });
    },
    ...options,
  });
  runtime.register("stub", {
    launch() {
      spawns.push(Date.now());
      return { command: process.execPath, args: [STUB, ...stubArgs] };
    },
  });
  const provider = {
    extensionId: "example.language",
    languageServerId: "example.language:stub",
    contribution: contribution(),
  };
  const bridge = {
    languageServersFor: (selector) =>
      selector === ".ts" || selector === "typescript" ? [provider] : [],
    invokeLanguage: (_extensionId, invocation) =>
      runtime.handle(
        invocation.method,
        { ...invocation.input, languageServerId: "stub" },
        invocation.signal ?? new AbortController().signal,
      ),
    onLanguageDiagnostics: () => () => undefined,
    onLanguageSessionExit: (listener) => {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    },
    onHostStateChanged: () => () => undefined,
  };
  return { runtime, bridge, exits, spawns };
}

async function projectRoot() {
  return mkdtemp(join(tmpdir(), "terminay-language-runtime-"));
}

test("a language server that hangs on initialize is not respawned inside the failure cooldown", async () => {
  const root = await projectRoot();
  const { runtime, bridge, exits, spawns } = harness(["--hang-on-initialize"], {
    startTimeoutMs: 300,
    shutdownTimeoutMs: 100,
  });
  const sessions = new LanguageSessionManager({
    extensions: bridge,
    projectRoot: async () => root,
    failureCooldownMs: 60_000,
  });
  await assert.rejects(
    sessions.positionRequest("default", "a.ts", "language.hover", { line: 0, character: 0 }),
  );
  // Exactly one exit: a `stopped` reported alongside would clear the cooldown.
  assert.equal(exits.length, 1);
  assert.equal(exits[0].reason, "start-failed");
  assert.equal(spawns.length, 1);
  assert.equal(sessions.describe("default", "a.ts").state, "unavailable");
  assert.equal(sessions.describe("default", "a.ts").reason, "launch-failed");
  await assert.rejects(
    sessions.positionRequest("default", "a.ts", "language.hover", { line: 0, character: 0 }),
  );
  assert.equal(spawns.length, 1, "the cooldown must hold off a second spawn");
  await sessions.shutdown();
  await runtime.stopAll();
});

test("an unframed stdout flood ends the session instead of growing without bound", async () => {
  const root = await projectRoot();
  const { runtime, exits } = harness(["--flood-stdout"], {
    startTimeoutMs: 10_000,
    shutdownTimeoutMs: 100,
  });
  await assert.rejects(
    runtime.handle(
      "language.session.start",
      { sessionId: "flood", languageServerId: "stub", projectRoot: root },
      new AbortController().signal,
    ),
  );
  assert.equal(exits.length, 1);
  assert.match(exits[0].failure ?? "", /framing limit/u);
  await runtime.stopAll();
});
