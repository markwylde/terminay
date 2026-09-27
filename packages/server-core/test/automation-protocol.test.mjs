import assert from "node:assert/strict";
import test from "node:test";
import { AutomationClient, TerminayClient, TerminayClientFacade } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import { FEATURE_CAPABILITIES } from "@terminay/protocol";
import {
  AUTOMATION_EVENTS,
  AutomationRepository,
  AutomationRunLog,
  createServerCoreComposition,
} from "../dist/index.js";

const serverId = "automation-server";

function memoryBackend() {
  let persisted;
  return {
    async load() { return persisted === undefined ? undefined : structuredClone(persisted); },
    async commit(state) { persisted = structuredClone(state); },
  };
}

function createPtyFactory() {
  return {
    spawn() {
      return { pid: 50_001, write() {}, resize() {}, kill() {}, onData() { return () => undefined; }, onExit() { return () => undefined; } };
    },
  };
}

function waitFor(predicate, timeoutMs = 2_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - started >= timeoutMs) return reject(new Error("timed out waiting for automation condition"));
      setTimeout(check, 5);
    };
    check();
  });
}

/** Authority by client id: `reader` may read only, `project-bound` is bound to
 * one project, `session-bound` to one terminal, anyone else may write. */
function authenticate({ hello }) {
  switch (hello.clientId) {
    case "reader": return { clientId: hello.clientId, authScope: "read" };
    case "project-bound": return { clientId: hello.clientId, authScope: "write", claims: { projectId: "project-a" } };
    case "session-bound": return { clientId: hello.clientId, authScope: "write", claims: { projectId: "project-a", sessionId: "session-a" } };
    default: return { clientId: hello.clientId, authScope: "write" };
  }
}

async function setup(controller) {
  const repository = new AutomationRepository(memoryBackend());
  const runLog = new AutomationRunLog(memoryBackend());
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId,
    serverVersion: "test",
    capabilities: [],
    ptyFactory: createPtyFactory(),
    authenticate,
    automations: { repository, runLog, ...(controller === undefined ? {} : { controller }) },
  });
  const clients = [];
  const connect = async (clientId) => {
    const pair = createInMemoryTransportPair({ autoOpen: false });
    await pair.open();
    const connection = composition.core.accept(pair.server);
    const task = connection.start();
    const client = new TerminayClient({ transport: pair.client, clientId, capabilities: [FEATURE_CAPABILITIES.automations] });
    clients.push({ client, connection, task, pair });
    await client.connect();
    return { client, automations: new AutomationClient(new TerminayClientFacade(client)) };
  };
  const close = async () => {
    for (const { client, connection, task, pair } of clients) {
      await client.close().catch(() => undefined);
      await connection.close().catch(() => undefined);
      await task.catch(() => undefined);
      await pair.client.close().catch(() => undefined);
      await pair.server.close().catch(() => undefined);
    }
    await composition.shutdown();
  };
  return { composition, repository, runLog, connect, close };
}

const scheduled = {
  id: "hourly",
  name: "Hourly",
  trigger: { kind: "schedule", cron: "0 * * * *" },
  action: { kind: "runCommand", command: "echo hi" },
};

const forbidden = (operation) => (error) =>
  error.name === "ClientOperationError" && error.operation === operation && error.cause?.code === "forbidden";

test("the server advertises automations.v1 when automations are composed", async () => {
  const fixture = await setup();
  try {
    assert.ok(fixture.composition.coreOptions.capabilities.includes(FEATURE_CAPABILITIES.automations));
  } finally {
    await fixture.close();
  }
});

test("automations.get names the zone the server evaluates schedules in", async () => {
  const fixture = await setup();
  try {
    const { automations } = await fixture.connect("owner");
    const state = await automations.get();
    assert.equal(state.timeZone, new Intl.DateTimeFormat().resolvedOptions().timeZone);
  } finally {
    await fixture.close();
  }
});

test("a client without terminal-create authority is refused every automation operation", async () => {
  const fixture = await setup();
  try {
    const { automations: writer } = await fixture.connect("writer");
    await writer.upsert(scheduled);
    for (const clientId of ["reader", "project-bound", "session-bound"]) {
      const { automations } = await fixture.connect(clientId);
      await assert.rejects(() => automations.get(), forbidden("automations.get"), clientId);
      await assert.rejects(() => automations.runs(), forbidden("automations.runs"), clientId);
      await assert.rejects(() => automations.upsert({ ...scheduled, id: "sneaky" }), forbidden("automations.upsert"), clientId);
      await assert.rejects(() => automations.setEnabled("hourly", false), forbidden("automations.set-enabled"), clientId);
      await assert.rejects(() => automations.remove("hourly"), forbidden("automations.remove"), clientId);
      await assert.rejects(() => automations.run("hourly"), forbidden("automations.run"), clientId);
      await assert.rejects(() => automations.stop("run-1"), forbidden("automations.stop"), clientId);
      await assert.rejects(() => automations.dismissMissed(), forbidden("automations.missed.dismiss"), clientId);
      await assert.rejects(() => automations.removeRun("run-1"), forbidden("automations.runs.remove"), clientId);
      await assert.rejects(() => automations.pruneRuns("hourly", 0), forbidden("automations.runs.prune"), clientId);
    }
    const state = await writer.get();
    assert.deepEqual(state.automations.map((automation) => [automation.id, automation.enabled]), [["hourly", true]]);
  } finally {
    await fixture.close();
  }
});

test("definition, run, and missed-run events reach subscribers", async () => {
  const started = [];
  const stopped = [];
  let runLog;
  const controller = {
    async start(request) {
      started.push(request);
      return runLog.record({
        runId: `run-${started.length}`,
        automationId: request.automation.id,
        triggerKind: request.automation.trigger.kind,
        firedAt: request.firedAt,
        startedBy: request.startedBy,
        status: "running",
        startedAt: request.firedAt,
        outputTail: "secret-ish output",
        suppressedEvents: 0,
      });
    },
    async stop(runId) { stopped.push(runId); return true; },
  };
  const fixture = await setup(controller);
  runLog = fixture.runLog;
  try {
    const { automations: editor } = await fixture.connect("editor");
    const { automations: observer } = await fixture.connect("observer");
    const changed = [];
    const runs = [];
    const missed = [];
    observer.onChanged((state) => changed.push(state));
    observer.onRunChanged((entry) => runs.push(entry));
    observer.onMissedChanged((records) => missed.push(records));

    const initial = await editor.get();
    const saved = await editor.upsert(scheduled, { expectedRevision: initial.revision });
    await waitFor(() => changed.length === 1);
    assert.equal(changed[0].revision, saved.revision);
    assert.deepEqual(changed[0].automations, [{ id: "hourly", enabled: true }], "change events carry ids and enabled state only");

    await assert.rejects(
      () => editor.upsert({ ...scheduled, name: "Stale" }, { expectedRevision: initial.revision }),
      (error) => error.cause?.code === "conflict",
    );
    await assert.rejects(
      () => editor.upsert({ ...scheduled, id: "bad", action: { kind: "writeText", text: "hi", submit: true } }),
      (error) => error.cause?.code === "validation" && /scheduled triggers have no subject terminal/.test(error.cause.message),
    );

    await fixture.runLog.recordMissed("hourly", 3, 1_000);
    await waitFor(() => missed.length === 1);
    assert.deepEqual(missed[0], [{ automationId: "hourly", missedCount: 3, latestDueAt: 1_000 }]);

    // Running from the missed notice starts an ordinary user run and clears
    // the entry for every client.
    const entry = await editor.run("hourly");
    assert.equal(entry.startedBy, "user");
    assert.equal(started[0].startedBy, "user");
    assert.equal(started[0].automation.id, "hourly");
    assert.equal(started[0].actor.clientId, "editor");
    await waitFor(() => runs.length === 1 && missed.length === 2);
    assert.equal(runs[0].runId, "run-1");
    assert.equal(runs[0].outputTail, undefined, "run events never carry terminal output");
    assert.equal(runs[0].status, "running");
    assert.deepEqual(missed[1], []);
    const history = await editor.runs("hourly");
    assert.equal(history.runs[0].outputTail, "secret-ish output");

    assert.deepEqual(await editor.stop("run-1"), { runId: "run-1", stopped: true });
    assert.deepEqual(stopped, ["run-1"]);
    await assert.rejects(() => editor.stop("run-unknown"), (error) => error.cause?.code === "not_found");

    const disabled = await editor.setEnabled("hourly", false);
    await waitFor(() => changed.length === 2);
    assert.equal(changed[1].automations[0].enabled, false);
    assert.equal(disabled.automations[0].enabled, false);

    await editor.upsert({ id: "nudge", name: "Nudge", trigger: { kind: "event", event: "agent.needsInput" }, action: { kind: "writeText", text: "continue", submit: true } });
    await assert.rejects(() => editor.run("nudge"), (error) => error.cause?.code === "validation", "a subject action run by hand needs a terminal");
    await editor.run("nudge", { serverId, projectId: "project-a", sessionId: "session-a" });
    assert.deepEqual(started.at(-1).subject, { kind: "terminal", serverId, projectId: "project-a", sessionId: "session-a" });
    await assert.rejects(
      () => editor.run("nudge", { serverId: "other-server", projectId: "project-a", sessionId: "session-a" }),
      (error) => error.cause?.code === "forbidden",
    );

    await editor.remove("hourly");
    await waitFor(() => changed.length === 4);
    assert.deepEqual(changed.at(-1).automations.map((automation) => automation.id), ["nudge"]);
    const journal = fixture.composition.eventJournal.replay().events.filter((event) => event.event.startsWith("automations."));
    assert.ok(journal.some((event) => event.event === AUTOMATION_EVENTS.missedChanged));
    // Journal events reach every subscriber regardless of authority: no names,
    // command lines, text, subjects, or output ever appear in them.
    const serialized = JSON.stringify(journal.map((event) => event.payload));
    for (const secret of ["echo hi", "Hourly", "Nudge", "continue", "secret-ish output", "project-a", "session-a", "writeText", "0 * * * *"])
      assert.equal(serialized.includes(secret), false, `event payloads leak ${secret}`);
  } finally {
    await fixture.close();
  }
});

test("run now is refused until an executor is composed", async () => {
  const fixture = await setup();
  try {
    const { automations } = await fixture.connect("writer");
    await automations.upsert(scheduled);
    await assert.rejects(() => automations.run("hourly"), (error) => error.cause?.code === "unavailable");
  } finally {
    await fixture.close();
  }
});

test("runs can be deleted and pruned, the prune choice is shared, and removals publish ids only", async () => {
  const fixture = await setup();
  const day = 86_400_000;
  const record = (index, overrides = {}) => fixture.runLog.record({
    runId: `run-${index}`,
    automationId: "hourly",
    triggerKind: "schedule",
    firedAt: Date.now() - index * day,
    startedBy: "trigger",
    status: "finished",
    outcome: "succeeded",
    startedAt: Date.now() - index * day,
    outputTail: "secret-ish output",
    suppressedEvents: 0,
    ...overrides,
  });
  try {
    const { automations: editor } = await fixture.connect("editor");
    const { automations: other } = await fixture.connect("other");
    await editor.upsert(scheduled);
    await record(1);
    await record(10);
    await record(40);
    await record(50, { status: "running", outcome: undefined });
    const removedEvents = [];
    other.onRunsRemoved((event) => removedEvents.push(event));

    assert.equal((await editor.runs("hourly")).pruneChoice, undefined);
    assert.deepEqual(await editor.removeRun("run-1"), { runId: "run-1", removed: 1 });
    await assert.rejects(() => editor.removeRun("run-50"), (error) => error.cause?.code === "validation", "a run in progress cannot be deleted");
    await assert.rejects(() => editor.removeRun("run-1"), (error) => error.cause?.code === "not_found");

    const pruned = await editor.pruneRuns("hourly", 7);
    assert.deepEqual(pruned, { removed: 2, pruneChoice: { olderThanDays: 7 } });
    const seen = await other.runs("hourly");
    assert.deepEqual(seen.pruneChoice, { olderThanDays: 7 }, "every client sees the remembered choice");
    assert.deepEqual(seen.runs.map((run) => run.runId), ["run-50"]);

    await waitFor(() => removedEvents.length === 2);
    assert.deepEqual(removedEvents[0], { automationId: "hourly", runIds: ["run-1"] });
    assert.deepEqual([...removedEvents[1].runIds].sort(), ["run-10", "run-40"]);
    const journal = fixture.composition.eventJournal.replay().events.filter((event) => event.event === AUTOMATION_EVENTS.runsRemoved);
    for (const event of journal) assert.deepEqual(Object.keys(event.payload).sort(), ["automationId", "runIds"]);
  } finally {
    await fixture.close();
  }
});

test("a shortened keep-history period removes old runs when the automation is saved", async () => {
  const fixture = await setup();
  const day = 86_400_000;
  try {
    const { automations: editor } = await fixture.connect("editor");
    await editor.upsert({ ...scheduled, settings: { keepHistoryDays: 30 } });
    for (const age of [2, 10])
      await fixture.runLog.record({ runId: `run-${age}`, automationId: "hourly", triggerKind: "schedule", firedAt: Date.now() - age * day, startedBy: "trigger", status: "finished", outcome: "succeeded", startedAt: Date.now() - age * day, suppressedEvents: 0 });
    assert.equal((await editor.runs("hourly")).runs.length, 2);
    const saved = await editor.upsert({ ...scheduled, settings: { keepHistoryDays: 7 } });
    assert.equal(saved.automations[0].settings.keepHistoryDays, 7);
    await waitFor(() => fixture.runLog.snapshot().runs.hourly?.length === 1);
    assert.deepEqual((await editor.runs("hourly")).runs.map((run) => run.runId), ["run-2"]);
  } finally {
    await fixture.close();
  }
});
