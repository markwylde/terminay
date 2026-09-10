import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  EXTENSION_EVENT_NAMES,
  EXTENSION_OPERATION_NAMES,
  OPERATION_POLICIES,
  createAgentExtensionHarness,
  defineAgentProvider,
  defineExtension,
  fixtureTerminal,
  hostileManifestFixtures,
  jsonlSession,
  namespacedId,
  validManifestFixture,
  validateAgentBindingFingerprint,
  validateAgentChildJournalSources,
  validateAgentEnvironmentRelativePath,
  validateAgentEnvironmentRelativePathRequest,
  validateAgentEnvironmentVariableNames,
  validateAgentHomeRelativeFileRequest,
  validateAgentHomeRelativePathRequest,
  validateAgentLifecycleEvent,
  validateAgentModelMetadata,
  validateAgentObservationDiagnostic,
  validateAgentObservedEnvironment,
  validateAgentPathUnderEnvironmentRequest,
  validateAgentPathUnderHomeRequest,
  validateAgentProcessEnvironmentRequest,
  validateAgentProviderContribution,
  validateAgentProviderDefinition,
  validateAgentSessionBindingRequest,
  validateAgentTerminalTtyFact,
  validateAgentRelativeToEnvironmentRequest,
  validateExtensionManifest,
} from "../dist/index.js";

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

test("agent-observation is the manifest permission every agent contribution requires", () => {
  assert.equal(validateExtensionManifest(validManifestFixture).ok, true);

  const missingPermission = validateExtensionManifest({
    ...validManifestFixture,
    permissions: ["network"],
  });
  assert.equal(missingPermission.ok, false);
  assert.ok(missingPermission.issues.some((issue) => issue.path === "$.permissions" && issue.code === "missing_permission"));
});

test("an agent provider contribution is the only supported contribution array", () => {
  const noContributions = validateExtensionManifest({ ...validManifestFixture, contributes: {} });
  assert.equal(noContributions.ok, false);
  assert.ok(noContributions.issues.some((issue) => issue.path === "$.contributes" && issue.code === "missing_contribution"));

  const environments = validateExtensionManifest(hostileManifestFixtures.projectEnvironments);
  assert.equal(environments.ok, false, "projectEnvironments is no longer a contribution kind");
  assert.ok(environments.issues.some((issue) => issue.code === "unknown_field"), "it fails as an unknown key");
});

test("agent provider contribution declarations are namespaced, bounded, and declarative", () => {
  const valid = {
    id: "dev.terminay.fixture/agent",
    displayName: "Fixture Agent",
    description: "Observes the fixture CLI.",
    icon: "terminal",
    platforms: ["darwin", "linux"],
    processMatchers: [{ executableName: "fixture-agent", arguments: ["--json"] }],
    mappings: [{ mappingVersion: "0.1", providerVersionRange: ">=1" }],
    requiredEnvironmentVariables: ["FIXTURE_AGENT_HOME"],
  };
  assert.equal(validateAgentProviderContribution(valid, "dev.terminay.fixture").ok, true);

  for (const [name, value, code] of [
    ["foreign provider id", { ...valid, id: "dev.other/agent" }, "invalid_namespace"],
    ["removed capability declaration", { ...valid, requiredEnvironmentCapabilities: ["process-observation"] }, "unknown_field"],
    ["unsafe environment variable name", { ...valid, requiredEnvironmentVariables: ["BAD-NAME"] }, "invalid_environment_variable"],
    ["executable callback", { ...valid, observe: () => {} }, "unknown_field"],
    ["unsafe matcher", { ...valid, processMatchers: [{ executableName: "fixture-agent", command: "fixture-agent --json" }] }, "unknown_field"],
  ]) {
    const result = validateAgentProviderContribution(value, "dev.terminay.fixture");
    assert.equal(result.ok, false, name);
    assert.ok(result.issues.some((issue) => issue.code === code), name);
  }
});

test("agent runtime provider declarations accept only the public callback contract", () => {
  const valid = {
    mappingVersion: "0.1",
    matchesForeground() { return true; },
    async observe() { return { state: "not-bound" }; },
  };
  assert.equal(validateAgentProviderDefinition(valid).ok, true);

  for (const [name, definition] of [
    ["missing matcher", { mappingVersion: "0.1", observe: valid.observe }],
    ["missing observer", { mappingVersion: "0.1", matchesForeground: valid.matchesForeground }],
    ["non-function matcher", { ...valid, matchesForeground: true }],
    ["host lifecycle callback", { ...valid, dispose() {} }],
  ]) {
    const result = validateAgentProviderDefinition(definition);
    assert.equal(result.ok, false, name);
    assert.ok(result.issues.length > 0, name);
  }
});

test("agent binding, metadata, and diagnostic validators reject nested or host-owned data", () => {
  assert.equal(validateAgentBindingFingerprint({ kind: "writable-file", file: { id: "file-1" }, metadata: { source: "journal", attempt: 1 } }).ok, true);
  assert.equal(validateAgentSessionBindingRequest({
    providerSessionId: "session-1",
    mappingVersion: "0.1",
    fingerprint: { kind: "writable-file", file: { id: "file-1" }, metadata: { source: "journal" } },
    metadata: { title: "Fixture task" },
  }).ok, true);
  assert.equal(validateAgentModelMetadata({ id: "fixture-1", displayName: "Fixture", contextWindowTokens: 128_000 }).ok, true);
  assert.equal(validateAgentObservationDiagnostic({ reason: "session-not-found", message: "No active session" }).ok, true);

  for (const [name, result] of [
    ["nested fingerprint metadata", validateAgentBindingFingerprint({ kind: "writer", file: { id: "file-1" }, metadata: { nested: { value: "no" } } })],
    ["nested session metadata", validateAgentSessionBindingRequest({ providerSessionId: "session-1", mappingVersion: "0.1", fingerprint: { kind: "writer", file: { id: "file-1" } }, metadata: { nested: ["no"] } })],
    ["host scope in diagnostic", validateAgentObservationDiagnostic({ reason: "session-not-found", terminalId: "terminal-1" })],
    ["unsafe diagnostic payload", validateAgentObservationDiagnostic({ reason: "session-not-found", error: { stack: "secret" } })],
    ["oversized model id", validateAgentModelMetadata({ id: "x".repeat(257) })],
  ]) {
    assert.equal(result.ok, false, name);
    assert.ok(result.issues.length > 0, name);
  }
});

test("terminal TTY facts and constrained journal path requests are bounded and fail closed", () => {
  assert.equal(validateAgentTerminalTtyFact({ deviceId: "pts/7", deviceName: "pts/7" }).ok, true);
  assert.equal(validateAgentHomeRelativeFileRequest({
    relativePath: ".claude/projects/demo/resume.jsonl",
    beneath: { homeRelative: ".claude/projects" }, extension: ".jsonl",
  }).ok, true);
  assert.equal(validateAgentPathUnderHomeRequest({
    providerPath: "/home/test/.omp/sessions/root.jsonl",
    beneath: { homeRelative: ".omp/sessions" }, extension: ".jsonl",
  }).ok, true);
  assert.equal(validateAgentHomeRelativePathRequest({
    handle: { id: "opaque-file" }, beneath: { homeRelative: ".omp/sessions" },
  }).ok, true);

  for (const [name, result] of [
    ["oversized TTY device id", validateAgentTerminalTtyFact({ deviceId: "x".repeat(257) })],
    ["TTY path field", validateAgentTerminalTtyFact({ deviceId: "pts/7", path: "/dev/pts/7" })],
    ["absolute home-relative path", validateAgentHomeRelativeFileRequest({ relativePath: "/etc/passwd" })],
    ["home-relative traversal", validateAgentHomeRelativeFileRequest({ relativePath: ".claude/../secret.jsonl" })],
    ["backslash home-relative path", validateAgentHomeRelativeFileRequest({ relativePath: ".claude\\resume.jsonl" })],
    ["relative provider path", validateAgentPathUnderHomeRequest({ providerPath: ".omp/sessions/root.jsonl", beneath: { homeRelative: ".omp/sessions" } })],
    ["unsafe provider root", validateAgentPathUnderHomeRequest({ providerPath: "/home/test/.omp/sessions/root.jsonl", beneath: { homeRelative: "../.omp" } })],
    ["missing fact-only root", validateAgentHomeRelativePathRequest({ handle: { id: "opaque-file" } })],
  ]) {
    assert.equal(result.ok, false, name);
    assert.ok(result.issues.length > 0, name);
  }
});

test("declared terminal environment facts and environment-root resolvers are bounded", () => {
  assert.equal(validateAgentEnvironmentVariableNames(["PI_CODING_AGENT_DIR"]).ok, true);
  assert.equal(validateAgentProcessEnvironmentRequest({ names: ["PI_CODING_AGENT_DIR"] }).ok, true);
  assert.equal(validateAgentObservedEnvironment({ PI_CODING_AGENT_DIR: "/var/lib/pi" }, ["PI_CODING_AGENT_DIR"]).ok, true);
  assert.equal(validateAgentRelativeToEnvironmentRequest({
    relativePath: "breadcrumbs/current.json", environmentVariable: "PI_CODING_AGENT_DIR",
  }).ok, true);
  assert.equal(validateAgentPathUnderEnvironmentRequest({
    providerPath: "/var/lib/pi/sessions/root.jsonl", environmentVariable: "PI_CODING_AGENT_DIR",
    beneathRelative: "sessions", extension: ".jsonl",
  }).ok, true);
  assert.equal(validateAgentEnvironmentRelativePathRequest({
    handle: { id: "opaque-file" }, environmentVariable: "PI_CODING_AGENT_DIR", beneathRelative: "sessions",
  }).ok, true);
  assert.equal(validateAgentEnvironmentRelativePath("root.jsonl").ok, true);

  for (const [name, result] of [
    ["duplicate declared variable", validateAgentEnvironmentVariableNames(["PI_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"])],
    ["unsafe declared variable", validateAgentProcessEnvironmentRequest({ names: ["PI-CODING-AGENT-DIR"] })],
    ["ambient unrequested fact", validateAgentObservedEnvironment({ HOME: "/host/home" }, ["PI_CODING_AGENT_DIR"])],
    ["oversized observed value", validateAgentObservedEnvironment({ PI_CODING_AGENT_DIR: "x".repeat(4_097) }, ["PI_CODING_AGENT_DIR"])],
    ["environment path traversal", validateAgentRelativeToEnvironmentRequest({ relativePath: "../journal.jsonl", environmentVariable: "PI_CODING_AGENT_DIR" })],
    ["raw environment root", validateAgentRelativeToEnvironmentRequest({ relativePath: "journal.jsonl", environmentVariable: "/var/lib/pi" })],
    ["relative provider environment path", validateAgentPathUnderEnvironmentRequest({ providerPath: "sessions/root.jsonl", environmentVariable: "PI_CODING_AGENT_DIR" })],
    ["environment root traversal", validateAgentPathUnderEnvironmentRequest({ providerPath: "/var/lib/pi/sessions/root.jsonl", environmentVariable: "PI_CODING_AGENT_DIR", beneathRelative: "../sessions" })],
    ["missing environment fact variable", validateAgentEnvironmentRelativePathRequest({ handle: { id: "opaque-file" } })],
    ["escaping environment fact", validateAgentEnvironmentRelativePath("../root.jsonl")],
  ]) {
    assert.equal(result.ok, false, name);
    assert.ok(result.issues.length > 0, name);
  }
});

test("JSONL child sources require stable bounded child evidence", () => {
  const watcher = { async *[Symbol.asyncIterator]() {}, dispose() {} };
  assert.equal(validateAgentChildJournalSources([
    { childId: "child-1", journal: { id: "child-journal" }, source: watcher },
  ]).ok, true);
  assert.equal(validateAgentChildJournalSources([
    { childId: "child-1", journal: { id: "child-a" }, source: watcher },
    { childId: "child-1", journal: { id: "child-b" }, source: watcher },
  ]).ok, false);
  assert.throws(() => jsonlSession({
    binding: { providerSessionId: "root" }, source: watcher,
    childSources: [{ childId: "child-1", journal: { id: "child-journal" }, source: {} }],
    mapRecord() {},
  }));
});

test("in-memory agent harness preserves TTY fallback, home bounds, and root/child JSONL context", async () => {
  const rootPath = "/home/test/.omp/sessions/root.jsonl";
  const childPath = "/home/test/.omp/sessions/children/child.jsonl";
  const externalRoot = "/var/lib/pi-agent";
  const externalJournalPath = `${externalRoot}/sessions/current.jsonl`;
  const terminal = fixtureTerminal({
    foregroundExecutable: "fixture-agent",
    tty: { deviceId: "pts/7", deviceName: "pts/7" },
    environment: { PI_CODING_AGENT_DIR: externalRoot },
    files: {
      [rootPath]: [{ type: "root" }],
      [childPath]: [{ type: "child" }],
      "/home/test/.claude/projects/demo/resume.jsonl": [{ type: "resume" }],
      [externalJournalPath]: [{ type: "external" }],
    },
  });

  assert.equal(terminal.tty?.deviceId, "pts/7");
  const resume = await terminal.observation.files.resolveHomeRelative(
    ".claude/projects/demo/resume.jsonl",
    { beneath: { homeRelative: ".claude/projects" }, extension: ".jsonl" },
  );
  assert.ok(resume);
  assert.deepEqual(await terminal.observation.processes.environment(["PI_CODING_AGENT_DIR"]), {
    PI_CODING_AGENT_DIR: externalRoot,
  });
  const externalJournal = await terminal.observation.files.resolveRelativeToEnvironment("sessions/current.jsonl", {
    environmentVariable: "PI_CODING_AGENT_DIR", extension: ".jsonl",
  });
  assert.ok(externalJournal);
  assert.equal(await terminal.observation.files.environmentRelativePath(externalJournal, {
    environmentVariable: "PI_CODING_AGENT_DIR", beneathRelative: "sessions",
  }), "current.jsonl");
  assert.equal(await terminal.observation.files.resolvePathUnderEnvironment(externalJournalPath, {
    environmentVariable: "PI_CODING_AGENT_DIR", beneathRelative: "other", extension: ".jsonl",
  }), undefined);
  assert.equal(await terminal.observation.files.resolvePathUnderHome(rootPath, {
    beneath: { homeRelative: ".omp/other" }, extension: ".jsonl",
  }), undefined);

  const seenJournals = [];
  const extension = defineExtension({
    activate(context) {
      context.subscriptions.add(context.agents.registerProvider("test/fixture", defineAgentProvider({
        mappingVersion: "0.1",
        matchesForeground(process) { return process.executableName === "fixture-agent"; },
        async observe(observedTerminal) {
          const root = await observedTerminal.observation.files.resolvePathUnderHome(rootPath, {
            beneath: { homeRelative: ".omp/sessions" }, extension: ".jsonl", signal: observedTerminal.signal,
          });
          const child = await observedTerminal.observation.files.resolvePathUnderHome(childPath, {
            beneath: { homeRelative: ".omp/sessions" }, extension: ".jsonl", signal: observedTerminal.signal,
          });
          if (!root || !child) return { state: "not-bound" };
          assert.equal(await observedTerminal.observation.files.homeRelativePath(child, {
            beneath: { homeRelative: ".omp/sessions" }, signal: observedTerminal.signal,
          }), "children/child.jsonl");
          const binding = await observedTerminal.bindSession({
            providerSessionId: "root-session", mappingVersion: "0.1", journal: root,
            fingerprint: { kind: "fixture-root", file: root },
          });
          return jsonlSession({
            binding,
            source: observedTerminal.observation.files.follow(root, { signal: observedTerminal.signal }),
            childSources: [{
              childId: "child-1", journal: child,
              source: observedTerminal.observation.files.follow(child, { signal: observedTerminal.signal }),
            }],
            mapRecord(record, recordContext) {
              seenJournals.push(recordContext.journal);
              if (record?.type === "root") recordContext.publish.sessionStarted({ title: "Root" });
              if (record?.type === "child" && recordContext.journal.role === "child") {
                recordContext.publish.subagentStarted({ subagentId: recordContext.journal.childId, title: "Child" });
              }
            },
          });
        },
      })));
    },
  });
  const harness = await createAgentExtensionHarness(extension);
  await harness.observe(terminal);
  assert.deepEqual(seenJournals, [{ role: "root" }, { role: "child", childId: "child-1" }]);
  assert.deepEqual(harness.events().map((event) => event.kind), ["session.started", "subagent.started"]);
  await harness.dispose();

  const withoutTty = fixtureTerminal({ foregroundExecutable: "fixture-agent" });
  assert.equal(withoutTty.tty, undefined, "TTY absence is a normal fallback state");
});

test("public agent lifecycle validator accepts only bounded provider-neutral event DTOs", () => {
  for (const event of [
    { kind: "session.started", title: "Fixture task", model: { id: "fixture-1", displayName: "Fixture" } },
    { kind: "turn.started", turnId: "turn-1", promptText: "Fix the fixtures" },
    { kind: "tool.started", toolId: "tool-1", name: "read_file" },
    { kind: "wait.started", waitId: "wait-1", state: "waiting", reason: "Approval required" },
    { kind: "agent.done", outcome: "success", summary: "Completed" },
    { kind: "subagent.done", subagentId: "child-1", outcome: "cancelled" },
  ]) {
    assert.equal(validateAgentLifecycleEvent(event).ok, true, event.kind);
  }

  for (const [name, event] of [
    ["terminal scope", { kind: "agent.done", outcome: "success", terminalId: "terminal-1" }],
    ["project scope", { kind: "agent.done", outcome: "success", projectId: "project-1" }],
    ["server scope", { kind: "agent.done", outcome: "success", serverId: "server-1" }],
    ["session scope", { kind: "agent.done", outcome: "success", sessionId: "session-1" }],
    ["host sequence", { kind: "agent.done", outcome: "success", sequence: 1 }],
    ["unknown event field", { kind: "agent.done", outcome: "success", rawRecord: { credential: "secret" } }],
    ["oversized title", { kind: "session.started", title: "x".repeat(513) }],
    ["oversized prompt", { kind: "turn.started", turnId: "turn-1", promptText: "x".repeat(4_097) }],
    ["nested metadata", { kind: "session.started", model: { id: "fixture-1", nested: { value: { value: { value: "no" } } } } }],
  ]) {
    const result = validateAgentLifecycleEvent(event);
    assert.equal(result.ok, false, name);
    assert.ok(result.issues.length > 0, name);
  }
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
