import assert from "node:assert/strict";
import test from "node:test";
import {
  EXTENSION_ICONS,
  EXTENSION_LIMITS,
  createAgentExtensionHarness,
  defineExtension,
  defineTerminalLauncher,
  isExecutablePath,
  validManifestFixture,
  validateExtensionManifest,
  validateTerminalLauncherContribution,
  validateTerminalLauncherResolution,
} from "../dist/index.js";

const id = validManifestFixture.id;
const launcherId = `${id}/launch-echo`;
const sourceId = `${id}/agents`;
const launcherManifest = Object.freeze({
  ...validManifestFixture,
  permissions: ["agent-launch"],
  contributes: {
    terminalLaunchers: [{ id: launcherId, displayName: "Echo", icon: "terminal" }],
  },
});
const harnessManifest = Object.freeze({
  ...validManifestFixture,
  permissions: ["agent-launch", "agent-observation"],
  contributes: {
    agentSessionSources: [
      { id: sourceId, displayName: "Agents", harnesses: [{ id: "echo", displayName: "Echo" }] },
    ],
    terminalLaunchers: [
      { id: launcherId, displayName: "Echo", icon: "agent-codex", harness: { source: sourceId, harness: "echo" } },
    ],
  },
});
const notInstalled = defineTerminalLauncher({
  async resolve() {
    return { available: false, reason: "not_installed" };
  },
});

test("a launcher-only package passes contribution validation", () => {
  assert.equal(validateExtensionManifest(launcherManifest).ok, true);
});

test("a launcher may name a harness its package declares", () => {
  assert.equal(validateExtensionManifest(harnessManifest).ok, true);
});

test("terminal launchers require agent-launch", () => {
  const result = validateExtensionManifest({ ...launcherManifest, permissions: [] });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "missing_permission" && /agent-launch/.test(issue.message)));
});

test("a launcher icon must come from the allowlist", () => {
  const result = validateExtensionManifest({
    ...launcherManifest,
    contributes: { terminalLaunchers: [{ id: launcherId, displayName: "Echo", icon: "rocket" }] },
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "unknown_icon"));
  assert.ok(EXTENSION_ICONS.includes("agent-claude-code"));
  assert.ok(EXTENSION_ICONS.includes("agent-codex"));
});

test("a launcher cannot name a harness its package does not declare", () => {
  const result = validateExtensionManifest({
    ...harnessManifest,
    contributes: {
      ...harnessManifest.contributes,
      terminalLaunchers: [
        { id: launcherId, displayName: "Echo", icon: "terminal", harness: { source: sourceId, harness: "other" } },
      ],
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "undeclared_harness"));
});

test("launcher declarations are namespaced and closed", () => {
  assert.equal(validateTerminalLauncherContribution({ id: launcherId, displayName: "Echo", icon: "terminal", platforms: ["linux"] }, id).ok, true);
  assert.equal(validateTerminalLauncherContribution({ id: "other.ext/echo", displayName: "Echo", icon: "terminal" }, id).ok, false);
  assert.equal(validateTerminalLauncherContribution({ id: launcherId, displayName: "Echo", icon: "terminal", args: ["--yolo"] }, id).ok, false);
});

test("a resolution names a bounded absolute executable and nothing else", () => {
  assert.deepEqual(
    validateTerminalLauncherResolution({ available: true, executable: "/usr/local/bin/echo", args: ["x"] }).value,
    { available: true, executable: "/usr/local/bin/echo" },
  );
  assert.equal(validateTerminalLauncherResolution({ available: true, executable: "echo" }).ok, false);
  assert.equal(validateTerminalLauncherResolution({ available: true, executable: "/bin/echo\nrm -rf ~" }).ok, false);
  assert.equal(
    validateTerminalLauncherResolution({ available: true, executable: `/${"x".repeat(EXTENSION_LIMITS.launcherExecutablePathLength)}` }).ok,
    false,
  );
  assert.equal(validateTerminalLauncherResolution({ available: false, reason: "not_signed_in" }).ok, false);
  const long = validateTerminalLauncherResolution({ available: false, reason: "not_installed", detail: "x".repeat(5000) });
  assert.equal(long.value.detail.length, EXTENSION_LIMITS.launcherDetailLength);
  assert.equal(isExecutablePath("C:\\Program Files\\echo.exe"), true);
});

test("a declared launcher registers and resolves through the harness", async () => {
  const harness = await createAgentExtensionHarness(
    defineExtension({
      activate(context) {
        context.subscriptions.add(
          context.terminals.registerLauncher(
            launcherId,
            defineTerminalLauncher({
              async resolve() {
                return { available: true, executable: "/usr/bin/echo" };
              },
            }),
          ),
        );
      },
    }),
    { manifest: launcherManifest },
  );
  assert.deepEqual(harness.registeredLauncherIds(), [launcherId]);
  assert.deepEqual(await harness.resolveLauncher(launcherId), { available: true, executable: "/usr/bin/echo" });
  await harness.dispose();
});

test("registering an undeclared launcher is refused", async () => {
  await assert.rejects(
    createAgentExtensionHarness(
      defineExtension({
        activate(context) {
          context.terminals.registerLauncher(`${id}/undeclared`, notInstalled);
        },
      }),
      { manifest: launcherManifest },
    ),
    /undeclared/,
  );
});

test("registering a launcher twice is refused", async () => {
  await assert.rejects(
    createAgentExtensionHarness(
      defineExtension({
        activate(context) {
          context.terminals.registerLauncher(launcherId, notInstalled);
          context.terminals.registerLauncher(launcherId, notInstalled);
        },
      }),
      { manifest: launcherManifest },
    ),
    /Duplicate/,
  );
});

test("registering after deactivation is refused", async () => {
  let saved;
  const harness = await createAgentExtensionHarness(
    defineExtension({
      activate(context) {
        saved = context;
      },
    }),
    { manifest: launcherManifest },
  );
  await harness.release("disable");
  assert.throws(() => saved.terminals.registerLauncher(launcherId, notInstalled), /deactivated/);
});
