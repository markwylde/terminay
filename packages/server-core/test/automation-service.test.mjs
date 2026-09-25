import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AUTOMATION_DEFINITIONS_FILE,
  AUTOMATION_RUNS_FILE,
  AutomationRepository,
  AutomationRunLog,
  AutomationServiceError,
  createAutomationFileBackends,
} from "../dist/index.js";

function memoryBackend(initial) {
  let persisted = initial;
  const commits = [];
  return {
    commits,
    get persisted() { return persisted; },
    async load() { return persisted === undefined ? undefined : structuredClone(persisted); },
    async commit(state) { persisted = structuredClone(state); commits.push(persisted); },
    async backup() {},
  };
}

const command = (overrides = {}) => ({
  id: "hourly",
  name: "Hourly script",
  trigger: { kind: "schedule", cron: "0 * * * *" },
  action: { kind: "runCommand", command: "~/bin/fix-conflicted-prs.sh" },
  ...overrides,
});

function run(automationId, index, overrides = {}) {
  return {
    runId: `run-${automationId}-${index}`,
    automationId,
    triggerKind: "schedule",
    firedAt: 1_000 + index,
    startedBy: "trigger",
    status: "finished",
    outcome: "succeeded",
    exitCode: 0,
    startedAt: 1_000 + index,
    finishedAt: 1_010 + index,
    suppressedEvents: 0,
    ...overrides,
  };
}

test("upsert normalises defaults and keeps evaluatedThrough server-maintained", async () => {
  let now = 5_000;
  const repository = new AutomationRepository(memoryBackend(), { now: () => now });
  const result = await repository.upsert({ ...command(), evaluatedThrough: 1 });
  assert.equal(result.ok, true);
  const [saved] = result.state.automations;
  assert.deepEqual(saved, {
    id: "hourly",
    name: "Hourly script",
    enabled: true,
    trigger: { kind: "schedule", cron: "0 * * * *" },
    action: { kind: "runCommand", command: "~/bin/fix-conflicted-prs.sh", maxDurationSeconds: 3600 },
    settings: { keepTerminalAfterRun: false, recordSession: false, cooldownSeconds: 60 },
    evaluatedThrough: 5_000,
  });

  await repository.markEvaluated("hourly", 9_000);
  assert.equal(repository.revision, 1, "schedule progress never advances the revision");
  now = 10_000;
  // An edit that keeps the same enabled schedule keeps its progress.
  const renamed = await repository.upsert({ ...command({ name: "Renamed" }), evaluatedThrough: 0 });
  assert.equal(renamed.state.automations[0].evaluatedThrough, 9_000);
  // Re-enabling starts evaluation afresh: occurrences while disabled are not missed.
  await repository.setEnabled("hourly", false);
  now = 20_000;
  const enabled = await repository.setEnabled("hourly", true);
  assert.equal(enabled.state.automations[0].evaluatedThrough, 20_000);
  // A missing id is generated.
  const generated = new AutomationRepository(memoryBackend(), { generateId: () => "generated-1" });
  const created = await generated.upsert(command({ id: undefined }));
  assert.equal(created.state.automations[0].id, "generated-1");
});

test("revision conflicts and idempotent command replays follow the macro envelope", async () => {
  const backend = memoryBackend();
  const repository = new AutomationRepository(backend);
  const first = await repository.upsert(command(), 0, "command-1");
  assert.equal(first.ok, true);
  assert.equal(first.revision, 1);
  const replay = await repository.upsert(command({ name: "Different" }), 0, "command-1");
  assert.deepEqual(replay, first, "a replayed command id returns the original outcome");
  assert.equal(backend.commits.length, 1);

  const stale = await repository.upsert(command({ name: "Stale" }), 0, "command-2");
  assert.equal(stale.ok, false);
  assert.equal(stale.conflict.code, "conflict");
  assert.equal(stale.conflict.currentRevision, 1);
  const staleReplay = await repository.upsert(command({ name: "Stale" }), 1, "command-2");
  assert.equal(staleReplay.ok, false, "a replayed conflict stays a conflict");

  const removed = await repository.remove("hourly", 1);
  assert.equal(removed.ok, true);
  assert.equal(removed.state.automations.length, 0);
  await assert.rejects(() => repository.remove("hourly"), (error) => error.code === "automation_not_found");
  await assert.rejects(() => repository.setEnabled("hourly", true), (error) => error.code === "automation_not_found");
});

test("subject actions are refused for schedule, project, and device triggers with a named reason", async () => {
  const repository = new AutomationRepository(memoryBackend());
  const actions = [
    { kind: "runMacro", macroId: "answer", fieldValues: {} },
    { kind: "writeText", text: "continue", submit: true },
  ];
  const refused = [
    [{ kind: "schedule", cron: "0 * * * *" }, "scheduled triggers have no subject terminal"],
    [{ kind: "event", event: "project.opened" }, "project events have no subject terminal"],
    [{ kind: "event", event: "project.closed" }, "project events have no subject terminal"],
    [{ kind: "event", event: "device.connected" }, "device events have no subject terminal"],
  ];
  for (const action of actions)
    for (const [trigger, reason] of refused)
      await assert.rejects(
        () => repository.upsert(command({ trigger, action })),
        (error) => error instanceof AutomationServiceError && error.code === "invalid_combination" && error.message === reason && error.details.reason === reason,
        `${trigger.kind}:${trigger.event ?? ""} + ${action.kind}`,
      );
  for (const event of ["agent.finished", "agent.needsInput", "agent.blocked", "terminal.needsAttention", "terminal.commandFinished", "terminal.idle"])
    for (const action of actions) {
      const saved = await repository.upsert(command({ id: `${event}-${action.kind}`.replace(/\./g, "-"), trigger: { kind: "event", event }, action }));
      assert.equal(saved.ok, true, `${event} + ${action.kind}`);
    }
  assert.equal(repository.revision, 12);
});

test("definitions are validated: cron, events, bounds, cooldown floor, and macro fields", async () => {
  const repository = new AutomationRepository(memoryBackend(), {
    resolveMacro: async (macroId) =>
      macroId === "answer"
        ? { fields: [{ name: "Reply", required: true, defaultValue: "" }, { name: "Optional", required: false, defaultValue: "" }] }
        : undefined,
  });
  const invalid = (candidate, pattern) =>
    assert.rejects(() => repository.upsert(candidate), (error) => error.code === "invalid_automation" && pattern.test(error.message), pattern.source);
  // The shared @terminay/cron parser names the field at fault.
  await assert.rejects(
    () => repository.upsert(command({ trigger: { kind: "schedule", cron: "61 * * * *" } })),
    (error) => error.code === "invalid_automation" && /minute field/.test(error.message) && error.details.cronField === "minute",
  );
  await assert.rejects(
    () => repository.upsert(command({ trigger: { kind: "schedule", cron: "0 0 31 2 *" } })),
    (error) => error.code === "invalid_automation" && /never/.test(error.message) && error.details.cronField === "dayOfMonth",
    "an expression that never matches is refused",
  );
  await invalid(command({ trigger: { kind: "schedule", cron: "* * *" } }), /five fields/);
  const custom = new AutomationRepository(memoryBackend(), { validateCron: () => ({ reason: "nope", field: "hour" }) });
  await assert.rejects(() => custom.upsert(command()), (error) => error.details.cronField === "hour" && /nope/.test(error.message));
  await invalid(command({ trigger: { kind: "event", event: "agent.done" } }), /trigger\.event/);
  await invalid(command({ name: "" }), /name/);
  await invalid(command({ name: "bad\nname" }), /name/);
  await invalid(command({ action: { kind: "runCommand", command: "   " } }), /action\.command/);
  await invalid(command({ action: { kind: "runCommand", command: "x", maxDurationSeconds: 0 } }), /maxDurationSeconds/);
  await invalid(command({ action: { kind: "shout" } }), /action\.kind/);
  await invalid(command({ enabled: "yes" }), /enabled/);
  await invalid(command({ id: "../escape" }), /id/);

  const subjectTrigger = { kind: "event", event: "agent.needsInput" };
  await invalid(
    command({ trigger: subjectTrigger, action: { kind: "writeText", text: "continue", submit: true }, settings: { cooldownSeconds: 0 } }),
    /cooldownSeconds/,
  );
  const commandCooldown = await repository.upsert(command({ id: "zero-cooldown", settings: { cooldownSeconds: 0 } }));
  assert.equal(commandCooldown.state.automations.at(-1).settings.cooldownSeconds, 0, "a command action may use no cooldown");

  await invalid(command({ trigger: subjectTrigger, action: { kind: "runMacro", macroId: "missing", fieldValues: {} } }), /macro is unavailable/);
  await invalid(command({ trigger: subjectTrigger, action: { kind: "runMacro", macroId: "answer", fieldValues: {} } }), /"Reply" has no value/);
  const macro = await repository.upsert(command({ id: "macro", trigger: subjectTrigger, action: { kind: "runMacro", macroId: "answer", fieldValues: { Reply: "yes" } } }));
  assert.equal(macro.ok, true);
});

test("persisted definitions that cannot be served are dropped and the rest restored", async () => {
  const backend = memoryBackend({
    schemaVersion: 1,
    revision: 7,
    automations: [
      { ...command(), enabled: false, settings: { keepTerminalAfterRun: true, recordSession: true, cooldownSeconds: 30 }, evaluatedThrough: 1234 },
      { ...command({ id: "broken" }), trigger: { kind: "schedule" } },
    ],
  });
  const repository = new AutomationRepository(backend);
  const state = await repository.load();
  assert.equal(state.revision, 7);
  assert.deepEqual(state.automations.map((automation) => automation.id), ["hourly"]);
  assert.equal(state.automations[0].enabled, false);
  assert.equal(state.automations[0].evaluatedThrough, 1234);
  assert.deepEqual(state.automations[0].settings, { keepTerminalAfterRun: true, recordSession: true, cooldownSeconds: 30 });
  assert.equal(backend.persisted.automations.length, 1);
});

test("the run log keeps 100 runs per automation, oldest dropped first", async () => {
  const log = new AutomationRunLog(memoryBackend());
  await log.load();
  for (let index = 0; index < 150; index += 1) await log.record(run("hourly", index));
  await log.record(run("other", 0));
  const runs = log.list("hourly");
  assert.equal(runs.length, 100);
  assert.equal(runs[0].runId, "run-hourly-149", "newest first");
  assert.equal(runs.at(-1).runId, "run-hourly-50", "the oldest 50 were dropped");
  assert.equal(log.list("other").length, 1, "the bound is per automation");
  assert.equal(log.list().length, 101);

  // Updating a run in place never evicts another.
  await log.record(run("hourly", 149, { outcome: "failed", exitCode: 2 }));
  assert.equal(log.list("hourly").length, 100);
  assert.equal(log.get("run-hourly-149").exitCode, 2);
  await assert.rejects(() => log.record({ runId: "bad" }), (error) => error.code === "invalid_automation");
});

test("the run log bounds output tails, counts suppressed events, and tracks missed runs", async () => {
  const log = new AutomationRunLog(memoryBackend());
  await log.load();
  const changes = [];
  log.subscribe((change) => changes.push(change));
  const long = `${"a".repeat(20 * 1024)}é${"z".repeat(16 * 1024 - 2)}`;
  const saved = await log.record(run("hourly", 1, { outputTail: long }));
  assert.ok(new TextEncoder().encode(saved.outputTail).byteLength <= 16 * 1024);
  assert.ok(long.endsWith(saved.outputTail));
  assert.ok(saved.outputTail.startsWith("é"), "the tail never splits a code point");

  assert.equal(await log.addSuppressed("missing"), undefined);
  await log.addSuppressed("hourly");
  const latest = await log.addSuppressed("hourly", 2);
  assert.equal(latest.suppressedEvents, 3);

  await log.recordMissed("hourly", 2, 3_600_000);
  const missed = await log.recordMissed("hourly", 1, 7_200_000);
  assert.deepEqual(missed, { automationId: "hourly", missedCount: 3, latestDueAt: 7_200_000 });
  await log.recordMissed("daily", 1, 100);
  assert.deepEqual(log.listMissed().map((record) => record.automationId), ["hourly", "daily"]);
  assert.equal(await log.dismissMissed("hourly"), true);
  assert.equal(await log.dismissMissed("hourly"), false);
  assert.equal(await log.dismissMissed(), true);
  assert.deepEqual(log.listMissed(), []);
  assert.deepEqual(changes.map((change) => change.type), ["run", "run", "run", "missed", "missed", "missed", "missed", "missed"]);
});

test("file backends restore definitions, enabled state, and the run log after a restart", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "terminay-automations-"));
  try {
    {
      const backends = createAutomationFileBackends(dataRoot);
      const repository = new AutomationRepository(backends.definitions);
      const log = new AutomationRunLog(backends.runs);
      await repository.upsert(command({ settings: { keepTerminalAfterRun: true, cooldownSeconds: 90 } }));
      await repository.upsert(command({ id: "nudge", name: "Nudge", trigger: { kind: "event", event: "agent.needsInput" }, action: { kind: "writeText", text: "continue", submit: true } }));
      await repository.setEnabled("nudge", false);
      await repository.markEvaluated("hourly", 42_000_000_000_000);
      await log.record(run("hourly", 1, { outputTail: "done\n", recordingId: "recording-1" }));
      await log.record(run("hourly", 2, { status: "running", outcome: undefined, finishedAt: undefined }));
      await log.addSuppressed("hourly", 4);
      await log.recordMissed("hourly", 3, 99);
    }
    const files = await readdir(dataRoot);
    assert.ok(files.includes(AUTOMATION_DEFINITIONS_FILE));
    assert.ok(files.includes(AUTOMATION_RUNS_FILE));
    assert.equal(files.some((file) => file.endsWith(".tmp")), false, "no temporary files remain");
    if (process.platform !== "win32")
      for (const file of [AUTOMATION_DEFINITIONS_FILE, AUTOMATION_RUNS_FILE])
        assert.equal((await stat(join(dataRoot, file))).mode & 0o777, 0o600, file);
    assert.equal(JSON.parse(await readFile(join(dataRoot, AUTOMATION_DEFINITIONS_FILE), "utf8")).revision, 3);

    const backends = createAutomationFileBackends(dataRoot);
    const repository = new AutomationRepository(backends.definitions);
    const log = new AutomationRunLog(backends.runs);
    const state = await repository.load();
    assert.equal(state.revision, 3);
    const hourly = state.automations.find((automation) => automation.id === "hourly");
    const nudge = state.automations.find((automation) => automation.id === "nudge");
    assert.equal(hourly.enabled, true);
    assert.equal(hourly.settings.keepTerminalAfterRun, true);
    assert.equal(hourly.settings.cooldownSeconds, 90);
    assert.equal(hourly.evaluatedThrough, 42_000_000_000_000);
    assert.equal(nudge.enabled, false);
    assert.deepEqual(nudge.action, { kind: "writeText", text: "continue", submit: true });

    await log.load();
    const runs = log.list("hourly");
    assert.deepEqual(runs.map((entry) => entry.runId), ["run-hourly-2", "run-hourly-1"]);
    assert.equal(runs[1].outputTail, "done\n");
    assert.equal(runs[1].recordingId, "recording-1");
    assert.equal(runs[0].status, "finished", "a run cut off by the restart is closed");
    assert.equal(runs[0].outcome, "stopped");
    assert.equal(runs[0].suppressedEvents, 4);
    assert.deepEqual(log.listMissed(), [{ automationId: "hourly", missedCount: 3, latestDueAt: 99 }]);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});
