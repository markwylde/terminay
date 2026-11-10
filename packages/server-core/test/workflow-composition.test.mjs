import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TerminayClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import { FEATURE_CAPABILITIES } from "@terminay/protocol";
import {
  createMemoryWorkflowTemplateBackend,
  createServerCoreComposition,
  WORKFLOW_EVENTS,
  WORKFLOW_LAUNCH_INSTRUCTION,
  WORKFLOW_OPERATIONS,
  WORKFLOW_RESUME_INSTRUCTION,
  WorkflowTemplateRepository,
} from "../dist/index.js";

const SERVER = "workflow-server";
const identity = { serverId: SERVER, projectId: "project-a", sessionId: "session-a" };
const target = { ...identity };

function recordingPty() {
  const processes = [];
  return {
    processes,
    spawn() {
      const data = new Set();
      const exits = new Set();
      const process = {
        pid: 6000 + processes.length,
        writes: [],
        write(bytes) { process.writes.push(typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes)); },
        resize() {},
        kill() {},
        onData(listener) { data.add(listener); return () => data.delete(listener); },
        onExit(listener) { exits.add(listener); return () => exits.delete(listener); },
        emitData(value) { for (const listener of data) listener(new TextEncoder().encode(value)); },
        emitExit() { for (const listener of exits) listener({ exitCode: 0, signal: null }); },
      };
      processes.push(process);
      return process;
    },
  };
}

const template = {
  id: "tpl-standard",
  name: "Standard flow",
  description: "",
  category: "Shipping",
  openingPrompt: "Ship the feature.",
  steps: [
    { title: "Propose", prompt: "Write the proposal." },
    { title: "Apply", prompt: "Implement it.", icon: "wrench" },
  ],
};

async function composed({ directory, templateRead } = {}) {
  const templates = new WorkflowTemplateRepository(createMemoryWorkflowTemplateBackend());
  await templates.apply({ command: { type: "upsert", template } });
  if (templateRead !== undefined) {
    // Holds every template read until the test lets it go.
    const read = templates.template.bind(templates);
    templates.template = async (id) => { await templateRead; return read(id); };
  }
  const pty = recordingPty();
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: SERVER,
    serverVersion: "test",
    capabilities: [],
    ptyFactory: pty,
    authenticate: ({ hello }) => ({
      clientId: hello.clientId,
      authScope: hello.clientId === "reader" ? "read" : "write",
      ...(hello.clientId.startsWith("bound-") ? { claims: { projectId: "project-b" } } : {}),
    }),
    workflows: { templates, ...(directory === undefined ? {} : { directory }) },
  });
  const cleanups = [];
  const connect = async (clientId) => {
    const pair = createInMemoryTransportPair({ autoOpen: false });
    await pair.open();
    const connection = composition.core.accept(pair.server);
    const task = connection.start();
    const client = new TerminayClient({ transport: pair.client, clientId, capabilities: [FEATURE_CAPABILITIES.workflows] });
    const hello = await client.connect();
    cleanups.push(async () => {
      await client.close().catch(() => undefined);
      await connection.close().catch(() => undefined);
      await task.catch(() => undefined);
    });
    // The operations' results, unwrapped from their envelopes.
    const api = {
      command: async (...args) => (await client.command(...args)).result,
      query: async (...args) => (await client.query(...args)).result,
      subscribe: (...args) => client.subscribe(...args),
    };
    return { client: api, hello };
  };
  await composition.start();
  await composition.terminal.createSession({ projectId: identity.projectId, sessionId: identity.sessionId, cols: 80, rows: 24 });
  return {
    composition,
    connect,
    process: () => pty.processes[0],
    close: async () => { for (const cleanup of cleanups) await cleanup(); await composition.shutdown(); },
  };
}

async function rejectsWith(promise, code, check = () => undefined) {
  await assert.rejects(promise, (error) => { assert.equal(error.code, code); check(error); return true; });
}

const launchText = `/goal ${template.openingPrompt}\n\n${WORKFLOW_LAUNCH_INSTRUCTION}`;

test("the server advertises workflows only when they are composed", async () => {
  const server = await composed();
  try {
    const { hello } = await server.connect("desktop");
    assert.ok(hello.capabilities.includes(FEATURE_CAPABILITIES.workflows));
  } finally {
    await server.close();
  }
});

test("a launch attaches the template's steps, not started, and types one paste submitted once", async () => {
  const server = await composed();
  const admitted = [];
  const write = server.composition.terminalInputSources.write.bind(server.composition.terminalInputSources);
  server.composition.terminalInputSources.write = (request) => { admitted.push(request); return write(request); };
  try {
    const { client } = await server.connect("desktop");
    server.process().emitData("\u001b[?2004h$ ");
    const view = await client.command(WORKFLOW_OPERATIONS.launch, { templateId: template.id, target });
    assert.equal(view.state, "attached");
    assert.deepEqual(view.workflow.steps.map((step) => [step.title, step.status, step.icon]), [["Propose", "not_started", ""], ["Apply", "not_started", "wrench"]]);
    assert.equal(view.workflow.templateId, template.id);
    assert.deepEqual(server.process().writes, [`\u001b[200~${launchText}\u001b[201~\r`]);
    assert.equal(admitted.length, 1);
    assert.equal(admitted[0].source, "workflow");
  } finally {
    await server.close();
  }
});

test("without bracketed paste the launch text is still submitted once", async () => {
  const server = await composed();
  try {
    const { client } = await server.connect("desktop");
    await client.command(WORKFLOW_OPERATIONS.launch, { templateId: template.id, target });
    assert.equal(server.process().writes.length, 1);
    assert.equal(server.process().writes[0].split("\r").length, 2);
    assert.ok(!server.process().writes[0].includes("\n"));
  } finally {
    await server.close();
  }
});

test("replacing an unfinished workflow needs its id, and a stale id is refused with the current one", async () => {
  const server = await composed();
  try {
    const { client } = await server.connect("desktop");
    const first = await client.command(WORKFLOW_OPERATIONS.launch, { templateId: template.id, target });
    await rejectsWith(client.command(WORKFLOW_OPERATIONS.launch, { templateId: template.id, target }), "conflict", (error) => {
      assert.equal(error.details.reason, "workflow_exists");
      assert.equal(error.details.workflowId, first.workflow.id);
    });
    await rejectsWith(
      client.command(WORKFLOW_OPERATIONS.launch, { templateId: template.id, target, replaceWorkflowId: "wf-stale" }),
      "conflict",
      (error) => assert.equal(error.details.workflowId, first.workflow.id),
    );
    // Neither refusal typed anything.
    assert.equal(server.process().writes.length, 1);
    const second = await client.command(WORKFLOW_OPERATIONS.launch, { templateId: template.id, target, replaceWorkflowId: first.workflow.id });
    assert.notEqual(second.workflow.id, first.workflow.id);
  } finally {
    await server.close();
  }
});

test("resume types the resume text and changes no step", async () => {
  const server = await composed();
  try {
    const { client } = await server.connect("desktop");
    const launched = await client.command(WORKFLOW_OPERATIONS.launch, { templateId: template.id, target });
    const stepId = launched.workflow.steps[0].id;
    await client.command(WORKFLOW_OPERATIONS.updateStep, { target, stepId, status: "running" });
    const before = await client.query(WORKFLOW_OPERATIONS.get, { terminalSessionId: identity.sessionId });
    const resumed = await client.command(WORKFLOW_OPERATIONS.resume, { target });
    assert.deepEqual(resumed.workflow.steps, before.workflow.steps);
    assert.equal(resumed.resumeStepId, stepId);
    assert.equal(server.process().writes.length, 2);
    assert.ok(server.process().writes[1].includes(WORKFLOW_RESUME_INSTRUCTION));
  } finally {
    await server.close();
  }
});

test("a terminal outside the caller's boundary, or a project it is not in, is refused as not found", async () => {
  const server = await composed();
  try {
    const bound = await server.connect("bound-phone");
    await rejectsWith(bound.client.command(WORKFLOW_OPERATIONS.launch, { templateId: template.id, target }), "not_found");
    const { client } = await server.connect("desktop");
    await rejectsWith(client.command(WORKFLOW_OPERATIONS.launch, { templateId: template.id, target: { ...target, projectId: "project-b" } }), "not_found");
    await rejectsWith(client.command(WORKFLOW_OPERATIONS.launch, { templateId: template.id, target: { ...target, serverId: "other" } }), "not_found");
    const reader = await server.connect("reader");
    await rejectsWith(reader.client.command(WORKFLOW_OPERATIONS.launch, { templateId: template.id, target }), "forbidden");
    assert.equal(server.process().writes.length, 0);
  } finally {
    await server.close();
  }
});

test("a change reaches a client that can see the terminal and no workflow reaches one that cannot", async () => {
  const server = await composed();
  try {
    const { client } = await server.connect("desktop");
    const other = await server.connect("phone");
    const bound = await server.connect("bound-phone");
    const seen = [];
    const subscription = await other.client.subscribe(WORKFLOW_EVENTS.changed);
    subscription.onEvent((entry) => seen.push(entry.payload));
    const launched = await client.command(WORKFLOW_OPERATIONS.launch, { templateId: template.id, target });
    await client.command(WORKFLOW_OPERATIONS.updateStep, { target, stepId: launched.workflow.steps[0].id, status: "done", note: "ok" });
    while (seen.length < 2) await new Promise((resolve) => setTimeout(resolve, 5));
    // Events carry the session and its state, never the workflow.
    assert.deepEqual(seen[0], { sessionId: identity.sessionId, state: "attached" });
    const fetched = await other.client.query(WORKFLOW_OPERATIONS.get, { terminalSessionId: identity.sessionId });
    assert.equal(fetched.workflow.steps[0].note, "ok");
    assert.deepEqual((await bound.client.query(WORKFLOW_OPERATIONS.list, {})).workflows, []);
    await rejectsWith(bound.client.query(WORKFLOW_OPERATIONS.get, { terminalSessionId: identity.sessionId }), "not_found");
    // A fresh client receives the workflow from the list.
    const late = await server.connect("laptop");
    const listed = await late.client.query(WORKFLOW_OPERATIONS.list, {});
    assert.equal(listed.workflows[0].workflow.id, launched.workflow.id);
  } finally {
    await server.close();
  }
});

test("a terminal that moves to another project while its launch reads the template is refused, and nothing changes", async () => {
  let release;
  const templateRead = new Promise((resolve) => { release = resolve; });
  const server = await composed({ templateRead });
  try {
    const { client } = await server.connect("desktop");
    const launch = client.command(WORKFLOW_OPERATIONS.launch, { templateId: template.id, target });
    await new Promise((resolve) => setTimeout(resolve, 10));
    server.composition.terminal.rehomeSession(identity.sessionId, "project-b");
    release();
    await rejectsWith(launch, "not_found");
    assert.equal((await client.query(WORKFLOW_OPERATIONS.get, { terminalSessionId: identity.sessionId })).state, "none");
    assert.deepEqual(server.process().writes, []);
  } finally {
    await server.close();
  }
});

test("a workflow stays on a project move, ends with its terminal, and the user can remove it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "terminay-workflow-composition-"));
  const server = await composed({ directory });
  try {
    const { client } = await server.connect("desktop");
    await client.command(WORKFLOW_OPERATIONS.launch, { templateId: template.id, target });
    server.composition.terminal.rehomeSession(identity.sessionId, "project-b");
    const moved = { ...target, projectId: "project-b" };
    assert.equal((await client.query(WORKFLOW_OPERATIONS.get, { terminalSessionId: identity.sessionId })).state, "attached");
    await rejectsWith(client.command(WORKFLOW_OPERATIONS.remove, { target }), "not_found");
    await client.command(WORKFLOW_OPERATIONS.remove, { target: moved });
    assert.equal((await client.query(WORKFLOW_OPERATIONS.get, { terminalSessionId: identity.sessionId })).state, "none");
    await client.command(WORKFLOW_OPERATIONS.launch, { templateId: template.id, target: moved });
    assert.equal(readdirSync(directory).filter((name) => name.endsWith(".json")).length, 1);
    server.process().emitExit();
    const store = server.composition.workflowStore;
    while (store.get(identity.sessionId) !== undefined) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(readdirSync(directory).filter((name) => !name.includes(".corrupt-")), []);
  } finally {
    await server.close();
  }
});

test("template commands are revisioned and announce only the revision", async () => {
  const server = await composed();
  try {
    const { client } = await server.connect("desktop");
    const seen = [];
    const subscription = await client.subscribe(WORKFLOW_EVENTS.templatesChanged);
    subscription.onEvent((entry) => seen.push(entry.payload));
    const state = await client.query(WORKFLOW_OPERATIONS.templatesGet, {});
    assert.deepEqual(state.categories, ["Shipping"]);
    const next = await client.command(
      WORKFLOW_OPERATIONS.templatesUpsert,
      { template: { ...template, id: "tpl-two", name: "Two" } },
      { expectedRevision: state.revision },
    );
    assert.deepEqual(next.templates.map((item) => item.id), ["tpl-standard", "tpl-two"]);
    await rejectsWith(
      client.command(WORKFLOW_OPERATIONS.templatesRemove, { templateId: "tpl-two" }, { expectedRevision: state.revision }),
      "conflict",
    );
    while (seen.length < 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(Object.keys(seen[0]).sort(), ["cursor", "revision"]);
  } finally {
    await server.close();
  }
});

// skip-workflow-steps

test("a client skips and restores a step through update-step, and a stale expected status is refused", async () => {
  const server = await composed();
  try {
    const { client } = await server.connect("desktop");
    const launched = await client.command(WORKFLOW_OPERATIONS.launch, { templateId: template.id, target });
    const [first, second] = launched.workflow.steps.map((step) => step.id);
    const skipped = await client.command(WORKFLOW_OPERATIONS.updateStep, {
      target, stepId: second, status: "skipped", note: "Skipped from the panel", expectedStatus: "not_started",
    });
    assert.equal(skipped.workflow.steps[1].status, "skipped");
    assert.equal(skipped.workflow.steps[1].note, "Skipped from the panel");
    await client.command(WORKFLOW_OPERATIONS.updateStep, { target, stepId: first, status: "running" });
    await rejectsWith(
      client.command(WORKFLOW_OPERATIONS.updateStep, { target, stepId: first, status: "skipped", expectedStatus: "not_started" }),
      "conflict",
      (error) => assert.equal(error.details.reason, "step_changed"),
    );
    await rejectsWith(
      client.command(WORKFLOW_OPERATIONS.updateStep, { target, stepId: first, status: "skipped", expectedStatus: "bogus" }),
      "validation",
    );
    const restored = await client.command(WORKFLOW_OPERATIONS.updateStep, { target, stepId: second, status: "not_started", expectedStatus: "skipped" });
    assert.deepEqual([restored.workflow.steps[1].status, restored.workflow.steps[1].note], ["not_started", ""]);
    assert.equal(restored.workflow.steps[0].status, "running");
    // Nothing is typed by a step update.
    assert.equal(server.process().writes.length, 1);
  } finally {
    await server.close();
  }
});

test("a step update naming a terminal outside the caller's reach, or another server, changes nothing", async () => {
  const server = await composed();
  try {
    const { client } = await server.connect("desktop");
    const launched = await client.command(WORKFLOW_OPERATIONS.launch, { templateId: template.id, target });
    const stepId = launched.workflow.steps[0].id;
    const bound = await server.connect("bound-phone");
    await rejectsWith(bound.client.command(WORKFLOW_OPERATIONS.updateStep, { target, stepId, status: "skipped" }), "not_found");
    await rejectsWith(client.command(WORKFLOW_OPERATIONS.updateStep, { target: { ...target, projectId: "project-b" }, stepId, status: "skipped" }), "not_found");
    await rejectsWith(client.command(WORKFLOW_OPERATIONS.updateStep, { target: { ...target, serverId: "other" }, stepId, status: "skipped" }), "not_found");
    const after = await client.query(WORKFLOW_OPERATIONS.get, { terminalSessionId: identity.sessionId });
    assert.equal(after.workflow.steps[0].status, "not_started");
  } finally {
    await server.close();
  }
});
