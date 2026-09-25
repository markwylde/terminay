import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AUTOMATION_PRINCIPAL,
  AUTOMATION_SPACE_PROJECT_ID,
  AutomationAuditLog,
  AutomationExecutor,
  AutomationRepository,
  AutomationRunLog,
  MacroRepository,
  MacroRunner,
  TerminalLaunchResolver,
  TerminalService,
  WorkspaceStore,
  createAutomationOperationRegistry,
  createInitialWorkspace,
  createWorkspaceOperationRegistry,
  OrderedEventJournal,
} from "../dist/index.js";

const SERVER = "exec-server";
const posix = process.platform !== "win32";

/** A real process behind the PtyProcess contract (pipes, not a TTY). */
function processPtyFactory() {
  return {
    spawn(options) {
      const child = spawn(options.shellPath, options.args, {
        cwd: options.cwd,
        env: Object.fromEntries(Object.entries(options.env ?? {}).filter(([, value]) => value !== undefined)),
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const data = new Set();
      const exits = new Set();
      let exited;
      // A PTY's line discipline turns \n into \r\n (onlcr); pipes do not.
      const emit = (chunk) => {
        const bytes = new TextEncoder().encode(chunk.toString("utf8").replace(/\r?\n/g, "\r\n"));
        for (const listener of [...data]) listener(bytes);
      };
      child.stdout.on("data", emit);
      child.stderr.on("data", emit);
      let open = 2;
      let code;
      const finish = () => {
        if (exited !== undefined || code === undefined || open > 0) return;
        exited = code;
        for (const listener of [...exits]) listener(exited);
      };
      const closed = () => { open -= 1; finish(); };
      child.stdout.on("close", closed);
      child.stderr.on("close", closed);
      child.on("exit", (exitCode, signal) => {
        code = { exitCode: exitCode ?? 128 + 15, signal: signal === null ? null : 15 };
        // A killed group may leave nothing holding the pipes; don't wait on them.
        setTimeout(() => { open = 0; finish(); }, 200).unref();
        finish();
      });
      child.on("error", () => { code = { exitCode: 127, signal: null }; open = 0; finish(); });
      return {
        pid: child.pid,
        write: (bytes) => new Promise((resolve) => child.stdin.write(Buffer.from(bytes), () => resolve())),
        resize() {},
        kill: () => { try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); } },
        onData(listener) { data.add(listener); return () => data.delete(listener); },
        onExit(listener) {
          exits.add(listener);
          if (exited !== undefined) listener(exited);
          return () => exits.delete(listener);
        },
      };
    },
  };
}

function memoryBackend() {
  let persisted;
  return { async load() { return persisted; }, async commit(state) { persisted = structuredClone(state); } };
}

function definition(overrides = {}) {
  return {
    id: "auto-1",
    name: "Nightly\nbuild",
    enabled: true,
    trigger: { kind: "schedule", cron: "0 * * * *" },
    action: { kind: "runCommand", command: "true", maxDurationSeconds: 60 },
    settings: { keepTerminalAfterRun: false, recordSession: false, cooldownSeconds: 60 },
    evaluatedThrough: 0,
    ...overrides,
  };
}

async function harness(t, options = {}) {
  const home = await realpath(await mkdtemp(join(tmpdir(), "terminay-exec-")));
  const workspace = new WorkspaceStore(createInitialWorkspace(SERVER));
  const viewId = workspace.state.viewOrder[0];
  assert.equal(workspace.apply({ commandId: "p", command: { type: "project.create", projectId: "project-a", viewId, root: home, name: "Alpha" } }).ok, true);
  const workspaceOperations = createWorkspaceOperationRegistry(workspace, {});
  const terminal = new TerminalService({ serverId: SERVER, ptyFactory: processPtyFactory() });
  terminal.onEvent((event) => {
    if (event.type === "exit")
      workspaceOperations.applyHostCommand(`exit:${event.sessionId}`, { type: "terminal.markExited", sessionId: event.sessionId, exitCode: event.exitCode });
  });
  const shellProfile = {
    id: "system", name: "System default", target: { kind: "executable", executable: "/bin/sh" }, args: ["-i"],
    startupMode: "default", environment: {}, kind: "system", readOnly: true, source: "system", availability: { available: true },
  };
  const resolver = new TerminalLaunchResolver({
    serverId: SERVER,
    profiles: {
      catalogue: async () => ({ settingsRevision: 1, defaultProfileId: "system", cwdPolicy: "project", entries: [shellProfile], projectReferences: {} }),
      resolveProfile: async (_id, catalogue) => ({ profile: shellProfile, definition: shellProfile, settingsRevision: catalogue.settingsRevision, target: shellProfile.target }),
    },
    workspaceSnapshot: () => workspace.state,
    defaultEnvironment: {
      PATH: process.env.PATH,
      HOME: home,
      TERMINAY_AUTOMATION_ID: "stale-inherited",
      TERMINAY_AGENT_STATE: "stale-inherited",
    },
  });
  const runLog = new AutomationRunLog(memoryBackend());
  await runLog.load();
  const audit = new AutomationAuditLog({ serverId: SERVER });
  const marks = [];
  const inputs = [];
  terminal.onInput((identity, bytes) => inputs.push({ sessionId: identity.sessionId, text: new TextDecoder().decode(bytes) }));
  const executor = new AutomationExecutor({
    serverId: SERVER,
    runLog,
    terminal,
    workspace,
    workspaceOperations,
    resolveLaunch: (intent) => resolver.resolve(intent),
    homeDirectory: async () => home,
    runTerminalRegistry: { mark: (id) => marks.push(["mark", id]), unmark: (id) => marks.push(["unmark", id]) },
    audit,
    ...options,
  });
  t.after(async () => {
    await executor.dispose();
    await terminal.shutdown().catch(() => undefined);
    await rm(home, { recursive: true, force: true });
  });
  return { home, workspace, workspaceOperations, terminal, runLog, audit, executor, marks, inputs };
}

async function finished(runLog, runId, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const entry = runLog.get(runId);
    if (entry?.status === "finished") return entry;
    if (Date.now() > deadline) throw new Error(`run ${runId} did not finish: ${JSON.stringify(entry)}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** A live subject terminal in project-a, with its panel. */
async function subjectTerminal(h, sessionId) {
  await h.terminal.createSession({ projectId: "project-a", sessionId, cwd: h.home, cols: 80, rows: 24, shell: "/bin/cat", args: [] });
  const snapshot = h.terminal.getSession(sessionId);
  assert.equal(h.workspaceOperations.applyHostCommand(`panel:${sessionId}`, { type: "terminal.createPanel", sessionId, projectId: "project-a", panelId: `p:${sessionId}`, title: "Agent tab", cwd: h.home }).ok, true);
  return { kind: "terminal", serverId: SERVER, projectId: "project-a", sessionId, sessionCreatedAt: snapshot.createdAt };
}

test("run command: real echo / exit 3 in the automation space with bounded context, tail, and close", { skip: !posix }, async (t) => {
  const h = await harness(t);
  const automation = definition({
    trigger: { kind: "event", event: "agent.finished" },
    action: {
      kind: "runCommand",
      maxDurationSeconds: 60,
      command: "printf '\\033[31mred\\033[0m\\n'; echo \"cwd=$(pwd)\"; env | grep '^TERMINAY_' | sort; exit 3",
    },
  });
  const entry = await h.executor.start({
    automation,
    startedBy: "trigger",
    firedAt: Date.UTC(2026, 8, 24, 9, 0, 0),
    event: "agent.finished",
    subject: { kind: "terminal", serverId: SERVER, projectId: "project-a", sessionId: "subject-1", title: "Agent\ttab" },
    context: { agentProvider: "codex", agentState: "done", agentOutcome: "error\nsecret-looking" },
  });
  assert.equal(entry.status, "running");
  const sessionId = entry.sessionId;
  assert.ok(sessionId);
  assert.equal(h.terminal.getSession(sessionId).projectId, AUTOMATION_SPACE_PROJECT_ID);
  assert.equal(h.workspace.state.projects[AUTOMATION_SPACE_PROJECT_ID].kind, "automations");
  assert.equal(h.executor.isRunning("auto-1"), true);

  const done = await finished(h.runLog, entry.runId);
  assert.equal(done.outcome, "failed");
  assert.equal(done.exitCode, 3);
  assert.equal(done.sessionId, undefined, "a closed run terminal is no longer linked");
  assert.ok(done.durationMs >= 0);
  const tail = done.outputTail;
  assert.match(tail, /^red$/m, "control sequences are stripped");
  assert.equal(tail.includes("\u001b"), false);
  assert.match(tail, new RegExp(`^cwd=${h.home}$`, "m"), "cwd defaults to home");
  assert.match(tail, /^TERMINAY_EVENT=agent\.finished$/m);
  assert.match(tail, /^TERMINAY_FIRED_AT=2026-09-24T09:00:00\.000Z$/m);
  assert.match(tail, /^TERMINAY_AUTOMATION_ID=auto-1$/m);
  assert.match(tail, /^TERMINAY_AUTOMATION_NAME=Nightly build$/m, "newlines never reach a value");
  assert.match(tail, /^TERMINAY_TERMINAL_HANDLE=subject-1$/m);
  assert.match(tail, /^TERMINAY_TERMINAL_TITLE=Agent tab$/m);
  assert.match(tail, /^TERMINAY_PROJECT_TITLE=Alpha$/m);
  assert.match(tail, /^TERMINAY_AGENT_PROVIDER=codex$/m);
  assert.match(tail, /^TERMINAY_AGENT_STATE=done$/m, "inherited context is replaced");
  assert.match(tail, /^TERMINAY_AGENT_OUTCOME=error secret-looking$/m);
  const names = [...tail.matchAll(/^(TERMINAY_[A-Z_]+)=/gm)].map((match) => match[1]).sort();
  assert.deepEqual(names, [
    "TERMINAY_AGENT_OUTCOME", "TERMINAY_AGENT_PROVIDER", "TERMINAY_AGENT_STATE", "TERMINAY_AUTOMATION_ID",
    "TERMINAY_AUTOMATION_NAME", "TERMINAY_EVENT", "TERMINAY_FIRED_AT", "TERMINAY_PROJECT_TITLE",
    "TERMINAY_TERMINAL_HANDLE", "TERMINAY_TERMINAL_TITLE",
  ]);
  assert.equal(h.workspace.state.panels[`p:${sessionId}`], undefined, "the run terminal closes by default");
  assert.deepEqual(h.marks, [["mark", sessionId], ["unmark", sessionId]]);
  assert.equal(h.executor.isRunning("auto-1"), false);
  assert.equal(h.executor.isRunTerminal(sessionId), false);

  const trail = h.audit.list().filter((record) => record.runId === entry.runId);
  assert.deepEqual(trail.map((record) => [record.operation, record.principal, record.actor.clientId]).reverse(), [
    ["automation.run.started", "automation", AUTOMATION_PRINCIPAL.clientId],
    ["automation.run.finished", "automation", AUTOMATION_PRINCIPAL.clientId],
  ]);
  assert.equal(trail[0].outcome, "failed");
});

test("run command: keep terminal after run keeps the exited terminal and its session link", { skip: !posix }, async (t) => {
  const h = await harness(t);
  const automation = definition({
    action: { kind: "runCommand", command: "echo kept", maxDurationSeconds: 60, cwd: "/" },
    settings: { keepTerminalAfterRun: true, recordSession: false, cooldownSeconds: 60 },
  });
  const entry = await h.executor.start({ automation, startedBy: "user", firedAt: 1, actor: { clientId: "desk", connectionId: "c1" } });
  const done = await finished(h.runLog, entry.runId);
  assert.equal(done.outcome, "succeeded");
  assert.equal(done.exitCode, 0);
  assert.equal(done.sessionId, entry.sessionId);
  assert.match(done.outputTail, /^kept$/m);
  const panel = h.workspace.state.panels[`p:${entry.sessionId}`];
  assert.equal(panel.projectId, AUTOMATION_SPACE_PROJECT_ID);
  assert.equal(panel.title, "Nightly build");
  assert.equal(h.workspace.state.terminalSessions[entry.sessionId].status, "exited");
  assert.equal(h.terminal.getSession(entry.sessionId).cwd, "/");
  assert.equal(h.audit.list().find((record) => record.runId === entry.runId).requestedBy.clientId, "desk");
});

test("terminals a run opens through MCP are recorded on the run, transitively, and outlive its terminal", { skip: !posix }, async (t) => {
  const h = await harness(t);
  // A script that keeps running until it is told to finish.
  const automation = definition({ action: { kind: "runCommand", command: "read line; exit 0", maxDurationSeconds: 60 } });
  const entry = await h.executor.start({ automation, startedBy: "trigger", firedAt: 1 });
  const runTerminal = entry.sessionId;
  assert.ok(runTerminal);

  // The script opens an agent terminal; the agent opens a helper of its own.
  assert.equal(await h.executor.recordOpenedTerminal(runTerminal, "agent-1"), entry.runId);
  assert.equal(await h.executor.recordOpenedTerminal("agent-1", "helper-1"), entry.runId);
  assert.equal(await h.executor.recordOpenedTerminal(runTerminal, "agent-1"), entry.runId, "recording twice is harmless");
  // A terminal no run owns records nothing.
  assert.equal(await h.executor.recordOpenedTerminal("stranger", "other-1"), undefined);
  assert.deepEqual(h.runLog.get(entry.runId).openedSessions, ["agent-1", "helper-1"]);

  await h.terminal.write(runTerminal, "done\n");
  const done = await finished(h.runLog, entry.runId);
  assert.equal(done.outcome, "succeeded");
  assert.equal(done.sessionId, undefined, "the run terminal closed");
  assert.deepEqual(done.openedSessions, ["agent-1", "helper-1"], "finishing the run keeps what it opened");

  // After the run ended, a terminal it opened still opens under that run.
  assert.equal(await h.executor.recordOpenedTerminal("helper-1", "helper-2"), entry.runId);
  assert.deepEqual(h.runLog.get(entry.runId).openedSessions, ["agent-1", "helper-1", "helper-2"]);
  assert.equal(h.runLog.list().find((run) => run.runId === entry.runId).status, "finished");
});

test("run command: the max-duration timer closes the terminal and logs timed out; stop logs stopped", { skip: !posix }, async (t) => {
  const h = await harness(t, { setTimer: (callback, ms) => setTimeout(callback, ms / 20) });
  const timed = await h.executor.start({
    automation: definition({ action: { kind: "runCommand", command: "echo started; sleep 30", maxDurationSeconds: 2 } }),
    startedBy: "trigger", firedAt: 1,
  });
  const done = await finished(h.runLog, timed.runId);
  assert.equal(done.outcome, "timedOut");
  assert.match(done.reason, /maximum duration/);
  assert.match(done.outputTail, /started/);
  assert.equal(h.workspace.state.panels[`p:${timed.sessionId}`], undefined);

  const long = await h.executor.start({
    automation: definition({ id: "auto-2", action: { kind: "runCommand", command: "sleep 30", maxDurationSeconds: 600 } }),
    startedBy: "user", firedAt: 1,
  });
  assert.equal(await h.executor.stop(long.runId), true);
  assert.equal((await finished(h.runLog, long.runId)).outcome, "stopped");
  assert.equal(await h.executor.stop(long.runId), false);
});

test("run command: the 50-terminal cap skips with automationSpaceFull", { skip: !posix }, async (t) => {
  const h = await harness(t);
  h.workspaceOperations.ensureAutomationSpace(h.home);
  for (let index = 0; index < 50; index += 1)
    assert.equal(h.workspaceOperations.applyHostCommand(`fill-${index}`, { type: "terminal.create", sessionId: `fill-${index}`, projectId: AUTOMATION_SPACE_PROJECT_ID }).ok, true);
  const entry = await h.executor.start({ automation: definition(), startedBy: "trigger", firedAt: 1 });
  assert.equal(entry.outcome, "skipped");
  assert.equal(entry.skipReason, "automationSpaceFull");
  assert.equal(h.terminal.listSessions().length, 0, "no terminal was spawned");
});

test("recording starts before the command writes output and a failure never fails the run", { skip: !posix }, async (t) => {
  const starts = [];
  let fail = false;
  const h = await harness(t, {
    recordings: {
      start(sessionId, metadata) {
        starts.push({ sessionId, existed: h.terminal.getSession(sessionId) !== undefined, metadata });
        if (fail) throw new Error("disk full");
        return { recordingId: "rec-1", status: "recording" };
      },
    },
  });
  const automation = definition({ settings: { keepTerminalAfterRun: false, recordSession: true, cooldownSeconds: 60 }, action: { kind: "runCommand", command: "echo recorded", maxDurationSeconds: 60 } });
  const recorded = await finished(h.runLog, (await h.executor.start({ automation, startedBy: "user", firedAt: 1 })).runId);
  assert.equal(recorded.outcome, "succeeded");
  assert.equal(recorded.recordingId, "rec-1");
  assert.equal(starts[0].existed, false, "recording starts before the PTY exists");
  assert.equal(starts[0].metadata.projectId, AUTOMATION_SPACE_PROJECT_ID);

  fail = true;
  const failed = await finished(h.runLog, (await h.executor.start({ automation, startedBy: "user", firedAt: 2 })).runId);
  assert.equal(failed.outcome, "succeeded");
  assert.equal(failed.recordingId, undefined);
});

test("write text renders the Eta subset over event context, submits, and the loop guard suppresses the same terminal only", { skip: !posix }, async (t) => {
  let now = 1_000_000;
  const h = await harness(t, { now: () => now });
  const subject = await subjectTerminal(h, "agent-1");
  const other = await subjectTerminal(h, "agent-2");
  const automation = definition({
    trigger: { kind: "event", event: "agent.needsInput" },
    action: { kind: "writeText", text: "continue {{terminalTitle}}<% if (it.agentState == \"waiting\") { %>!<% } %>", submit: true },
    settings: { keepTerminalAfterRun: false, recordSession: false, cooldownSeconds: 0 },
  });
  const request = { automation, startedBy: "trigger", firedAt: now, event: "agent.needsInput", subject, context: { agentState: "waiting" } };
  const first = await h.executor.start(request);
  assert.equal(first.outcome, "succeeded");
  assert.deepEqual(h.inputs, [{ sessionId: "agent-1", text: "continue Agent tab!" }, { sessionId: "agent-1", text: "\r" }]);

  // Cooldown 0 is clamped to the 5 s subject-action minimum.
  now += 4_000;
  assert.equal(await h.executor.fire({ ...request, firedAt: now }), undefined);
  const suppressed = await h.executor.start({ ...request, firedAt: now });
  assert.equal(suppressed.runId, first.runId);
  assert.equal(h.runLog.get(first.runId).suppressedEvents, 2);
  assert.equal(h.inputs.length, 2, "nothing written while suppressed");

  const different = await h.executor.start({ ...request, subject: other });
  assert.equal(different.outcome, "succeeded");
  assert.equal(h.inputs.filter((input) => input.sessionId === "agent-2").length, 2);

  now += 2_000;
  assert.equal((await h.executor.start({ ...request, firedAt: now })).outcome, "succeeded", "fires again after the cooldown");
});

test("the loop guard holds for two events for one subject that arrive together", { skip: !posix }, async (t) => {
  const h = await harness(t);
  const subject = await subjectTerminal(h, "agent-burst");
  const automation = definition({
    trigger: { kind: "event", event: "agent.needsInput" },
    action: { kind: "writeText", text: "continue", submit: true },
  });
  const request = { automation, startedBy: "trigger", firedAt: 1, event: "agent.needsInput", subject };
  // Neither call waits for the other: the second arrives while the first is
  // still recording its run.
  const [first, second] = await Promise.all([h.executor.fire(request), h.executor.fire({ ...request, firedAt: 2 })]);
  assert.equal(first?.outcome, "succeeded");
  assert.equal(second, undefined, "the second event is suppressed");
  assert.equal(h.inputs.filter((input) => input.text === "continue").length, 1, "written once");
  assert.equal(h.runLog.get(first.runId).suppressedEvents, 1);
});

test("subject actions skip with subjectGone for a closed or replaced subject and write nothing anywhere", { skip: !posix }, async (t) => {
  const h = await harness(t);
  const subject = await subjectTerminal(h, "agent-3");
  await subjectTerminal(h, "bystander");
  const automation = definition({
    trigger: { kind: "event", event: "agent.needsInput" },
    action: { kind: "writeText", text: "continue", submit: true },
  });
  const replaced = await h.executor.start({ automation, startedBy: "trigger", firedAt: 1, event: "agent.needsInput", subject: { ...subject, sessionCreatedAt: subject.sessionCreatedAt - 1 } });
  assert.equal(replaced.outcome, "skipped");
  assert.equal(replaced.skipReason, "subjectGone");

  await h.terminal.kill("agent-3");
  await new Promise((resolve) => setTimeout(resolve, 300));
  const closed = await h.executor.start({ automation, startedBy: "trigger", firedAt: 2, event: "agent.needsInput", subject });
  assert.equal(closed.skipReason, "subjectGone");
  const macro = await h.executor.start({ automation: definition({ trigger: automation.trigger, action: { kind: "runMacro", macroId: "m", fieldValues: {} } }), startedBy: "trigger", firedAt: 3, event: "agent.needsInput", subject });
  assert.equal(macro.skipReason, "subjectGone");
  assert.deepEqual(h.inputs, [], "nothing was written to any terminal");
});

test("run macro uses MacroRunner with the exact target and the automation principal", { skip: !posix }, async (t) => {
  const repository = new MacroRepository(memoryBackend());
  await repository.load();
  await repository.upsert({ id: "greet", title: "Greet", fields: [{ name: "Name", type: "text", required: true }], steps: [{ type: "type", content: "hi {{Name}}" }] });
  const seen = [];
  let terminalRef;
  const h = await harness(t, {
    macros: {
      repository,
      runner: new MacroRunner(),
      environmentFor: (request, target) => {
        seen.push({ clientId: request.context.clientId, scope: request.context.authScope, target });
        return { target, write: (candidate, bytes) => terminalRef.input(candidate, bytes, { ...candidate, scope: "write" }) };
      },
    },
  });
  terminalRef = h.terminal;
  const subject = await subjectTerminal(h, "agent-4");
  const entry = await h.executor.start({
    automation: definition({ trigger: { kind: "event", event: "agent.blocked" }, action: { kind: "runMacro", macroId: "greet", fieldValues: { Name: "Ada" } } }),
    startedBy: "trigger", firedAt: 1, event: "agent.blocked", subject,
  });
  const done = await finished(h.runLog, entry.runId);
  assert.equal(done.outcome, "succeeded");
  assert.deepEqual(seen, [{ clientId: AUTOMATION_PRINCIPAL.clientId, scope: "write", target: { serverId: SERVER, projectId: "project-a", sessionId: "agent-4" } }]);
  assert.deepEqual(h.inputs, [{ sessionId: "agent-4", text: "hi Ada" }]);
});

test("the server-wide limit of 8 runs skips over-limit runs; scheduled runs never overlap", { skip: !posix }, async (t) => {
  const h = await harness(t);
  const started = [];
  for (let index = 0; index < 8; index += 1)
    started.push(await h.executor.start({ automation: definition({ id: `busy-${index}`, action: { kind: "runCommand", command: "sleep 30", maxDurationSeconds: 600 } }), startedBy: "trigger", firedAt: 1 }));
  assert.equal(h.executor.runningCount, 8);
  const over = await h.executor.start({ automation: definition({ id: "late" }), startedBy: "user", firedAt: 1 });
  assert.equal(over.outcome, "skipped");
  assert.equal(over.skipReason, "concurrencyLimit");
  await h.executor.stop(started[7].runId);
  await finished(h.runLog, started[7].runId);
  const overlap = await h.executor.start({ automation: definition({ id: "busy-0", action: { kind: "runCommand", command: "true", maxDurationSeconds: 60 } }), startedBy: "trigger", firedAt: 2 });
  assert.equal(overlap.skipReason, "previousRunStillRunning");
  for (const entry of started) await h.executor.stop(entry.runId);
  for (const entry of started) await finished(h.runLog, entry.runId);
});

test("the audit trail records definition changes with the editing actor", async () => {
  const audit = new AutomationAuditLog({ serverId: SERVER });
  const repository = new AutomationRepository(memoryBackend());
  const runLog = new AutomationRunLog(memoryBackend());
  const registry = createAutomationOperationRegistry({
    serverId: SERVER, repository, runLog, eventJournal: new OrderedEventJournal(),
    onAudit: (record) => audit.recordRequest(record),
  });
  const upsert = registry.operations.commands["automations.upsert"];
  await upsert({
    envelope: { type: "command", commandId: "save-1", correlationId: "save-1", operation: "automations.upsert", payload: { automation: { id: "a1", name: "A", trigger: { kind: "schedule", cron: "0 * * * *" }, action: { kind: "runCommand", command: "true" } } } },
    body: new Uint8Array(),
    context: { connectionId: "conn-1", clientId: "editor", authScope: "write", signal: new AbortController().signal },
  });
  const [entry] = audit.list();
  assert.equal(entry.type, "definition");
  assert.equal(entry.principal, "client");
  assert.equal(entry.automationId, "a1");
  assert.deepEqual(entry.actor, { clientId: "editor", connectionId: "conn-1" });
  assert.equal(JSON.stringify(entry).includes("runCommand"), false, "metadata only");
  registry.dispose();
});
