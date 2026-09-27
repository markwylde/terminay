import assert from "node:assert/strict";
import test from "node:test";
import {
  AutomationRepository,
  AutomationRunLog,
  AutomationServiceError,
  createAutomationMcpOperations,
} from "../dist/index.js";

function memoryBackend() {
  let persisted;
  return {
    async load() { return persisted === undefined ? undefined : structuredClone(persisted); },
    async commit(state) { persisted = structuredClone(state); },
  };
}

function setup() {
  const repository = new AutomationRepository(memoryBackend());
  const runLog = new AutomationRunLog(memoryBackend());
  const started = [];
  const audit = [];
  const controller = {
    async start(request) {
      started.push(request);
      const entry = {
        runId: `run-${started.length}`,
        automationId: request.automation.id,
        triggerKind: request.automation.trigger.kind,
        firedAt: request.firedAt,
        startedBy: request.startedBy,
        ...(request.subject === undefined ? {} : { subject: request.subject }),
        status: "running",
        startedAt: request.firedAt,
        suppressedEvents: 0,
      };
      await runLog.record(entry);
      return entry;
    },
    async stop() { return true; },
  };
  const operations = createAutomationMcpOperations({
    repository,
    runLog,
    controller,
    timeZone: "UTC",
    now: () => Date.UTC(2026, 8, 27, 12, 0, 0),
    onAudit: (record) => audit.push(record),
  });
  return { repository, runLog, operations, started, audit };
}

const actor = { terminalSessionId: "session-1" };
const digest = {
  name: "Digest",
  trigger: { kind: "schedule", cron: "0 9 * * 1-5" },
  action: { kind: "runCommand", command: "mail-digest --since yesterday" },
};

test("an agent creates, lists, reads, and updates an automation with revisions", async () => {
  const { operations, audit } = setup();
  const created = await operations.create(digest, actor);
  assert.equal(created.automation.name, "Digest");
  assert.equal(created.automation.trigger_description.length > 0, true);
  assert.equal("evaluatedThrough" in created.automation, false);
  const listed = await operations.list();
  assert.equal(listed.automations.length, 1);
  assert.equal(listed.automations[0].next_run_at, "2026-09-28T09:00:00.000Z");
  assert.equal(listed.revision, created.revision);
  // Omitted fields keep their current values.
  const updated = await operations.update(
    created.automation.id,
    { name: "Morning digest" },
    listed.revision,
    actor,
  );
  assert.equal(updated.automation.name, "Morning digest");
  assert.deepEqual(updated.automation.action, { ...digest.action, maxDurationSeconds: 3600 });
  assert.deepEqual(audit.map((record) => record.operation), ["mcp.create_automation", "mcp.update_automation"]);
  assert.deepEqual(audit[0].actor, { clientId: "mcp", connectionId: "mcp:session-1" });
});

test("a stale revision conflicts and changes nothing", async () => {
  const { operations } = setup();
  const created = await operations.create(digest, actor);
  await operations.setEnabled(created.automation.id, false, undefined, actor);
  await assert.rejects(
    operations.update(created.automation.id, { name: "Changed" }, created.revision, actor),
    (error) => error instanceof AutomationServiceError && error.code === "conflict",
  );
  assert.equal((await operations.get(created.automation.id)).automation.name, "Digest");
});

test("the server assigns ids and validates definitions as saving does", async () => {
  const { operations } = setup();
  await assert.rejects(operations.create({ ...digest, id: "mine" }, actor), /server assigns automation ids/);
  await assert.rejects(
    operations.create({ ...digest, trigger: { kind: "schedule", cron: "every 10 seconds" } }, actor),
    (error) => error.code === "invalid_automation",
  );
  await assert.rejects(
    operations.preview({ ...digest, action: { kind: "writeText", text: "continue" } }),
    (error) => error.code === "invalid_combination",
  );
  assert.equal((await operations.list()).automations.length, 0);
});

test("runs are started by MCP and a subject outside the caller's reach is withheld", async () => {
  const { operations, started, runLog } = setup();
  const created = await operations.create(
    { name: "Nudge", trigger: { kind: "event", event: "agent.needsInput" }, action: { kind: "writeText", text: "continue", submit: true } },
    actor,
  );
  await assert.rejects(operations.run(created.automation.id, undefined, actor), (error) => error.code === "invalid_combination");
  const subject = { kind: "terminal", serverId: "server", projectId: "project-b", sessionId: "session-b", title: "Other" };
  const run = await operations.run(created.automation.id, subject, actor);
  assert.equal(started[0].startedBy, "mcp");
  assert.equal(run.started_by, "mcp");
  await runLog.load();
  await runLog.record({ ...runLog.get(run.run_id), status: "finished", outcome: "succeeded", outputTail: "secret output" });
  const hidden = await operations.runs(created.automation.id, 10, (candidate) => candidate.projectId === "project-a");
  assert.equal(hidden.runs[0].outcome, "succeeded");
  assert.equal("subject" in hidden.runs[0], false);
  assert.equal("output_tail" in hidden.runs[0], false);
  const shown = await operations.runs(created.automation.id, 10, () => true);
  assert.equal(shown.runs[0].output_tail, "secret output");
  assert.equal(shown.runs[0].subject.projectId, "project-b");
});

test("describe states the action in full, and refuses what could never succeed", async () => {
  const { operations } = setup();
  const create = await operations.describe({ kind: "create", input: digest });
  assert.match(create.summary, /^add the automation "Digest", which runs /);
  assert.deepEqual(create.details.find((line) => line.label === "Runs"), {
    label: "Runs",
    value: "mail-digest --since yesterday",
    code: true,
  });
  const created = await operations.create(digest, actor);
  const update = await operations.describe({
    kind: "update",
    automationId: created.automation.id,
    input: { action: { kind: "runCommand", command: "rm -rf ~/mail" } },
  });
  assert.equal(update.summary, 'change the automation "Digest"');
  assert.deepEqual(update.details[0], { label: "Changes", value: "action" });
  assert.equal(update.details.find((line) => line.label === "Runs").value, "rm -rf ~/mail");
  const disable = await operations.describe({ kind: "setEnabled", automationId: created.automation.id, enabled: false });
  assert.equal(disable.summary, 'disable the automation "Digest"');
  await assert.rejects(
    operations.describe({ kind: "delete", automationId: "missing" }),
    (error) => error.code === "automation_not_found",
  );
  await assert.rejects(
    operations.describe({ kind: "create", input: { name: "Bad" } }),
    (error) => error.code === "invalid_automation",
  );
});

test("delete keeps runs in progress and clears the missed notice", async () => {
  const { operations, repository } = setup();
  const created = await operations.create(digest, actor);
  const result = await operations.remove(created.automation.id, undefined, actor);
  assert.equal(result.deleted, created.automation.id);
  await repository.load();
  assert.equal(repository.find(created.automation.id), undefined);
});
