import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import * as sdk from "../dist/index.js";
import {
  EXTENSION_API_VERSION,
  EXTENSION_EVENT_NAMES,
  EXTENSION_LIMITS,
  EXTENSION_OPERATION_NAMES,
  OPERATION_POLICIES,
  boundedAgentText,
  hostileManifestFixtures,
  namespacedId,
  validManifestFixture,
  validateAgentSessionReset,
  validateAgentSessionSnapshot,
  validateAgentSessionSourceContribution,
  validateAgentSessionSourceDiagnostic,
  validateExtensionManifest,
  validateMcpInstallTargetActionResult,
  validateMcpInstallTargetContribution,
  validateMcpInstallTargetStatus,
  validateMcpServerCommand,
} from "../dist/index.js";

const snapshot = Object.freeze({
  id: "session-1",
  harness: "fixture-agent",
  pid: 4242,
  cwd: "/home/test/project",
  title: "Fix the build",
  model: "fixture-model",
  status: "running",
  tool: "Bash",
  lastTurn: "completed",
  lastTurnEndedAt: 1_700_000_000_000,
  subagents: [{ id: "sub-1", type: "explore", title: "Look around", status: "running" }],
});

test("the SDK is major version 3", () => {
  assert.equal(EXTENSION_API_VERSION, "3.1.0");
});

test("every public extension operation and event obeys the wire protocol grammar", () => {
  const operationPattern = /^[a-z][a-z0-9._:-]{0,255}$/;
  for (const name of [...EXTENSION_OPERATION_NAMES, ...EXTENSION_EVENT_NAMES]) {
    assert.match(name, operationPattern, name);
  }
});

test("valid fixture conforms to the closed manifest schema", () => {
  assert.deepEqual(validateExtensionManifest(validManifestFixture), { ok: true, value: validManifestFixture });
});

test("hostile manifests fail closed before import", () => {
  for (const [name, fixture] of Object.entries(hostileManifestFixtures)) {
    const result = validateExtensionManifest(fixture);
    assert.equal(result.ok, false, name);
    assert.ok(result.issues.length > 0, name);
  }
});

test("session sources require agent-observation and install targets require mcp-registration", () => {
  for (const [fixture, message] of [
    [hostileManifestFixtures.missingAgentObservation, /agent-observation/],
    [hostileManifestFixtures.missingMcpRegistration, /mcp-registration/],
  ]) {
    const result = validateExtensionManifest(fixture);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.path === "$.permissions" && issue.code === "missing_permission" && message.test(issue.message)));
  }
});

test("session sources, MCP install targets, and language servers are the supported contribution arrays", () => {
  const noContributions = validateExtensionManifest({ ...validManifestFixture, contributes: {} });
  assert.equal(noContributions.ok, false);
  assert.ok(noContributions.issues.some((issue) => issue.path === "$.contributes" && issue.code === "missing_contribution"));

  const sourceOnly = validateExtensionManifest({
    ...validManifestFixture,
    permissions: ["agent-observation"],
    contributes: { agentSessionSources: validManifestFixture.contributes.agentSessionSources },
  });
  assert.equal(sourceOnly.ok, true);

  for (const name of ["projectEnvironments", "agentProviders"]) {
    const result = validateExtensionManifest(hostileManifestFixtures[name]);
    assert.equal(result.ok, false, `${name} is not a contribution kind`);
    assert.ok(result.issues.some((issue) => issue.code === "unknown_field"), `${name} fails as an unknown key`);
  }
});

test("the terminal-scoped provider surface is gone from the public SDK", () => {
  for (const name of [
    "jsonlSession",
    "notBound",
    "defineAgentProvider",
    "fixtureTerminal",
    "createAgentLifecyclePublisher",
    "createJsonlRecordDecoder",
    "validateAgentProviderContribution",
    "validateAgentLifecycleEvent",
    "validateAgentSessionBindingRequest",
  ]) {
    assert.equal(name in sdk, false, name);
  }
});

test("session source declarations are namespaced, bounded, and declarative", () => {
  const valid = {
    id: "dev.terminay.fixture/agents",
    displayName: "Fixture Agents",
    description: "Reports fixture sessions.",
    platforms: ["darwin", "linux"],
    harnesses: [{ id: "fixture-agent", displayName: "Fixture Agent" }],
    environmentVariables: ["FIXTURE_AGENT_HOME"],
  };
  assert.equal(validateAgentSessionSourceContribution(valid, "dev.terminay.fixture").ok, true);

  const tooMany = Array.from({ length: EXTENSION_LIMITS.agentSourceHarnesses + 1 }, (_, index) => ({ id: `h-${index}`, displayName: `H ${index}` }));
  for (const [name, value, code] of [
    ["foreign source id", { ...valid, id: "dev.other/agents" }, "invalid_namespace"],
    ["no harnesses", { ...valid, harnesses: [] }, "invalid_array"],
    ["too many harnesses", { ...valid, harnesses: tooMany }, "invalid_array"],
    ["duplicate harness", { ...valid, harnesses: [valid.harnesses[0], valid.harnesses[0]] }, "duplicate"],
    ["unsafe harness id", { ...valid, harnesses: [{ id: "../claude", displayName: "Claude" }] }, "invalid_id"],
    ["unsafe environment variable name", { ...valid, environmentVariables: ["BAD-NAME"] }, "invalid_environment_variable"],
    ["removed matcher", { ...valid, processMatchers: [{ executableName: "fixture-agent" }] }, "unknown_field"],
  ]) {
    const result = validateAgentSessionSourceContribution(value, "dev.terminay.fixture");
    assert.equal(result.ok, false, name);
    assert.ok(result.issues.some((issue) => issue.code === code), name);
  }
});

test("MCP install target declarations are namespaced and closed", () => {
  const valid = { id: "dev.terminay.fixture/claude-code", displayName: "Claude Code" };
  assert.equal(validateMcpInstallTargetContribution(valid, "dev.terminay.fixture").ok, true);
  assert.equal(validateMcpInstallTargetContribution({ ...valid, id: "dev.other/claude-code" }, "dev.terminay.fixture").ok, false);
  assert.equal(validateMcpInstallTargetContribution({ ...valid, configPath: "~/.claude.json" }, "dev.terminay.fixture").ok, false);
});

test("session snapshots are closed, bounded, and name an enabled harness", () => {
  assert.equal(validateAgentSessionSnapshot(snapshot, ["fixture-agent"]).ok, true);
  assert.equal(validateAgentSessionSnapshot({ id: "s", harness: "fixture-agent", pid: 1, cwd: "/" }).ok, true, "only identity, pid, and cwd are required");

  for (const [name, value, code, harnesses] of [
    ["undeclared harness", snapshot, "harness_not_enabled", ["other-agent"]],
    ["transcript content", { ...snapshot, transcript: "secret" }, "unknown_field"],
    ["raw record", { ...snapshot, raw: {} }, "unknown_field"],
    ["relative cwd", { ...snapshot, cwd: "project" }, "invalid_path"],
    ["no pid", { ...snapshot, pid: undefined }, "invalid_integer"],
    ["unknown status", { ...snapshot, status: "busy" }, "invalid_enum"],
    ["oversized title", { ...snapshot, title: "x".repeat(EXTENSION_LIMITS.agentTitleLength + 1) }, "invalid_string"],
    ["oversized error", { ...snapshot, error: "x".repeat(EXTENSION_LIMITS.agentErrorLength + 1) }, "invalid_string"],
    ["subagent without status", { ...snapshot, subagents: [{ id: "a", type: "t" }] }, "invalid_enum"],
    ["duplicate subagent", { ...snapshot, subagents: [snapshot.subagents[0], snapshot.subagents[0]] }, "duplicate"],
    ["too many subagents", { ...snapshot, subagents: Array.from({ length: EXTENSION_LIMITS.agentSubagents + 1 }, (_, index) => ({ id: `s${index}`, type: "t", status: "running" })) }, "invalid_array"],
  ]) {
    const result = validateAgentSessionSnapshot(value, harnesses);
    assert.equal(result.ok, false, name);
    assert.ok(result.issues.some((issue) => issue.code === code), name);
  }
});

test("a reset never reports one session twice", () => {
  assert.equal(validateAgentSessionReset([snapshot, { ...snapshot, id: "session-2" }]).ok, true);
  const duplicate = validateAgentSessionReset([snapshot, snapshot]);
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.issues.some((issue) => issue.code === "duplicate"));
});

test("diagnostics carry a kebab-case code and a bounded message", () => {
  assert.equal(validateAgentSessionSourceDiagnostic({ code: "provider-error", message: "Grok provider failed" }).ok, true);
  assert.equal(validateAgentSessionSourceDiagnostic({ code: "Provider Error", message: "x" }).ok, false);
  assert.equal(validateAgentSessionSourceDiagnostic({ code: "provider-error", message: "x", path: "/home" }).ok, false);
});

test("MCP server commands and target results are bounded", () => {
  assert.equal(validateMcpServerCommand({ command: "/usr/bin/terminay", args: ["mcp"], env: { ELECTRON_RUN_AS_NODE: "1" } }).ok, true);
  assert.equal(validateMcpServerCommand({ command: "/usr/bin/terminay", args: "mcp" }).ok, false);
  assert.equal(validateMcpServerCommand({ command: "/usr/bin/terminay", args: [], env: { "BAD-NAME": "1" } }).ok, false);
  assert.equal(validateMcpInstallTargetStatus({ state: "installed", configPath: "/home/test/.claude.json" }).ok, true);
  assert.equal(validateMcpInstallTargetStatus({ state: "maybe", configPath: "/home/test/.claude.json" }).ok, false);
  assert.equal(validateMcpInstallTargetActionResult({ ok: true, installed: true }).ok, true);
  assert.equal(validateMcpInstallTargetActionResult({ ok: "yes", installed: true }).ok, false);
});

test("bounded agent text never splits a surrogate pair", () => {
  assert.equal(boundedAgentText("hello", 10), "hello");
  assert.equal(boundedAgentText("hello", 3), "hel");
  assert.equal(boundedAgentText("a\u{1F600}", 2), "a");
  assert.equal(boundedAgentText("", 3), undefined);
  assert.equal(boundedAgentText(42, 3), undefined);
});

test("namespacing rejects traversal and core-shaped local ids", () => {
  assert.equal(namespacedId("com.example.agent", "cli"), "com.example.agent/cli");
  assert.throws(() => namespacedId("com.example.agent", "../terminal.create"));
});

test("every fixed operation has exactly one transport permission policy", () => {
  assert.deepEqual(Object.keys(OPERATION_POLICIES).sort(), [...EXTENSION_OPERATION_NAMES].sort());
  assert.ok(EXTENSION_EVENT_NAMES.every((name) => name.includes(".")));
});

test("conformance CLI validates package identity and exported entrypoint", async () => {
  const directory = await mkdtemp(join(tmpdir(), "terminay-extension-api-"));
  const packagePath = join(directory, "package.json");
  await writeFile(packagePath, JSON.stringify({
    name: "@example/fixture",
    version: "1.0.0",
    type: "module",
    exports: { ".": `./${validManifestFixture.entrypoint}` },
    terminay: validManifestFixture,
  }));
  const result = spawnSync(process.execPath, [resolve("dist/conformance.js"), packagePath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Valid Terminay extension/);
});
