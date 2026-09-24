import assert from "node:assert/strict";
import test from "node:test";
import {
  AutomationRepository,
  AutomationRunLog,
  AutomationScheduler,
} from "../dist/index.js";

const HOUR = 3_600_000;
const MINUTE = 60_000;
const at = (iso) => Date.parse(iso);

function memoryBackend(initial) {
  let persisted = initial;
  return {
    get persisted() { return persisted; },
    async load() { return persisted === undefined ? undefined : structuredClone(persisted); },
    async commit(state) { persisted = structuredClone(state); },
    async backup() {},
  };
}

/** A clock whose timers only fire when the test advances it. */
function fakeClock(start) {
  let now = start;
  let nextId = 0;
  const timers = new Map();
  return {
    timers,
    get now() { return now; },
    set now(value) { now = value; },
    clock: {
      now: () => now,
      setTimeout: (handler, delayMs) => {
        const id = ++nextId;
        timers.set(id, { handler, dueAt: now + delayMs });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
    /** Move time forward, firing each timer at its due time. */
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.dueAt <= target).sort((a, b) => a[1].dueAt - b[1].dueAt)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        now = Math.max(now, due[1].dueAt);
        due[1].handler();
        await settle();
      }
      now = target;
    },
    /** The host slept: wall time jumps, then the pending timer fires late. */
    async sleepAndWake(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        timers.delete(id);
        timer.handler();
      }
      await settle();
    },
  };
}

async function settle() {
  for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

function fakeController(runLog, clock) {
  const requests = [];
  let sequence = 0;
  return {
    requests,
    async start(request) {
      requests.push(request);
      sequence += 1;
      return runLog.record({
        runId: `run-${sequence}`,
        automationId: request.automation.id,
        triggerKind: request.automation.trigger.kind,
        firedAt: request.firedAt,
        startedBy: request.startedBy,
        status: "running",
        startedAt: clock.now,
        suppressedEvents: 0,
      });
    },
    async finish(runId) {
      const entry = runLog.get(runId);
      await runLog.record({ ...entry, status: "finished", outcome: "succeeded", finishedAt: clock.now });
    },
    async stop() { return false; },
  };
}

const hourly = (overrides = {}) => ({
  id: "hourly",
  name: "Hourly",
  trigger: { kind: "schedule", cron: "0 * * * *" },
  action: { kind: "runCommand", command: "true" },
  ...overrides,
});

async function setup({ start, persisted, automations = [] } = {}) {
  const time = fakeClock(start ?? at("2026-01-05T09:30:00Z"));
  const repository = new AutomationRepository(memoryBackend(persisted), { now: () => time.now });
  await repository.load();
  for (const automation of automations) await repository.upsert(automation);
  const runLog = new AutomationRunLog(memoryBackend());
  await runLog.load();
  const controller = fakeController(runLog, time);
  const scheduler = new AutomationScheduler({
    repository,
    runLog,
    controller: () => controller,
    clock: time.clock,
    timeZone: "UTC",
    onError: (error) => { throw error; },
  });
  await scheduler.start();
  return { time, repository, runLog, controller, scheduler };
}

test("one timer is armed to the earliest due time across enabled schedules", async () => {
  const { time, scheduler } = await setup({
    automations: [hourly(), hourly({ id: "five", name: "Five", trigger: { kind: "schedule", cron: "*/5 * * * *" } })],
  });
  assert.equal(time.timers.size, 1);
  assert.equal(scheduler.armedFor, at("2026-01-05T09:35:00Z"));
  assert.equal(scheduler.nextDueAt("hourly"), at("2026-01-05T10:00:00Z"));
  scheduler.stop();
  assert.equal(time.timers.size, 0);
});

test("a due schedule runs once, advances evaluatedThrough, and re-arms", async () => {
  const { time, repository, controller, scheduler } = await setup({ automations: [hourly()] });
  await time.advance(30 * MINUTE);
  assert.equal(controller.requests.length, 1);
  assert.equal(controller.requests[0].firedAt, at("2026-01-05T10:00:00Z"));
  assert.equal(controller.requests[0].startedBy, "trigger");
  assert.equal(repository.find("hourly").evaluatedThrough, at("2026-01-05T10:00:00Z"));
  assert.equal(scheduler.armedFor, at("2026-01-05T11:00:00Z"));
  assert.equal(time.timers.size, 1);
  scheduler.stop();
});

test("edit, disable, enable, and remove re-arm the single timer", async () => {
  const { time, repository, scheduler } = await setup({ automations: [hourly()] });
  await repository.upsert(hourly({ trigger: { kind: "schedule", cron: "45 * * * *" } }));
  assert.equal(scheduler.armedFor, at("2026-01-05T09:45:00Z"));
  await repository.setEnabled("hourly", false);
  assert.equal(scheduler.armedFor, undefined);
  assert.equal(time.timers.size, 0);
  await repository.setEnabled("hourly", true);
  assert.equal(scheduler.armedFor, at("2026-01-05T09:45:00Z"));
  await repository.remove("hourly");
  assert.equal(time.timers.size, 0);
  scheduler.stop();
});

test("a schedule never overlaps its previous run: the occurrence is logged as skipped", async () => {
  const { time, runLog, controller, scheduler } = await setup({ automations: [hourly()] });
  await time.advance(30 * MINUTE); // 10:00 starts run-1, which keeps running
  await time.advance(HOUR); // 11:00
  assert.equal(controller.requests.length, 1);
  const skipped = runLog.list("hourly").find((entry) => entry.outcome === "skipped");
  assert.equal(skipped.skipReason, "previousRunStillRunning");
  assert.equal(skipped.firedAt, at("2026-01-05T11:00:00Z"));
  assert.equal(skipped.triggerKind, "schedule");
  await controller.finish("run-1");
  await time.advance(HOUR); // 12:00 runs again
  assert.equal(controller.requests.length, 2);
  scheduler.stop();
});

test("a 3-hour outage counts three missed occurrences at start and runs none", async () => {
  const persisted = {
    schemaVersion: 1,
    revision: 1,
    cursor: "1",
    automations: [{
      ...hourly(),
      enabled: true,
      action: { kind: "runCommand", command: "true", maxDurationSeconds: 3600 },
      settings: { keepTerminalAfterRun: false, recordSession: false, cooldownSeconds: 60 },
      evaluatedThrough: at("2026-01-05T09:30:00Z"),
    }],
  };
  const { runLog, controller, repository, scheduler } = await setup({ start: at("2026-01-05T12:30:00Z"), persisted });
  assert.equal(controller.requests.length, 0);
  assert.deepEqual(runLog.listMissed(), [{ automationId: "hourly", missedCount: 3, latestDueAt: at("2026-01-05T12:00:00Z") }]);
  assert.equal(repository.find("hourly").evaluatedThrough, at("2026-01-05T12:30:00Z"));
  assert.equal(scheduler.armedFor, at("2026-01-05T13:00:00Z"));
  scheduler.stop();
});

test("a timer that fires more than 60 s late counts the slept-through occurrences as missed", async () => {
  const { time, runLog, controller, repository, scheduler } = await setup({ automations: [hourly()] });
  await time.sleepAndWake(3 * HOUR); // armed for 10:00, woke at 12:30
  assert.equal(controller.requests.length, 0);
  assert.deepEqual(runLog.listMissed(), [{ automationId: "hourly", missedCount: 3, latestDueAt: at("2026-01-05T12:00:00Z") }]);
  assert.equal(repository.find("hourly").evaluatedThrough, at("2026-01-05T12:30:00Z"));
  assert.equal(scheduler.armedFor, at("2026-01-05T13:00:00Z"));
  scheduler.stop();
});

test("waking within 60 s of an occurrence runs it and counts only the earlier ones", async () => {
  const { time, runLog, controller, scheduler } = await setup({ automations: [hourly()] });
  await time.sleepAndWake(90 * MINUTE + 30_000); // woke at 11:00:30
  assert.equal(controller.requests.length, 1);
  assert.equal(controller.requests[0].firedAt, at("2026-01-05T11:00:00Z"));
  assert.deepEqual(runLog.listMissed(), [{ automationId: "hourly", missedCount: 1, latestDueAt: at("2026-01-05T10:00:00Z") }]);
  scheduler.stop();
});

test("without a controller a due run is logged as skipped, not lost silently", async () => {
  const time = fakeClock(at("2026-01-05T09:30:00Z"));
  const repository = new AutomationRepository(memoryBackend(), { now: () => time.now });
  await repository.load();
  await repository.upsert(hourly());
  const runLog = new AutomationRunLog(memoryBackend());
  const scheduler = new AutomationScheduler({ repository, runLog, controller: () => undefined, clock: time.clock, timeZone: "UTC" });
  await scheduler.start();
  await time.advance(30 * MINUTE);
  assert.equal(runLog.list("hourly")[0].skipReason, "executorUnavailable");
  scheduler.stop();
});
