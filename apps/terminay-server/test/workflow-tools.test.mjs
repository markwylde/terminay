import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  createMemoryWorkflowTemplateBackend,
  createWorkflowOperationRegistry,
  mcpPrincipalCommandRequest,
  mcpPrincipalQueryRequest,
  OrderedEventJournal,
  WORKFLOW_LIMITS,
  WorkflowStore,
  WorkflowTemplateRepository,
} from "@terminay/server-core";

const {
  CONTROL_PERMISSION_GROUPS,
  ControlCapabilityStore,
  ControlEndpointError,
  createControlEndpoint,
  createTerminalControlAdapter,
  createWorkflowControlAdapter,
  parseCreateWorkflow,
  parseGetWorkflow,
  parseUpdateWorkflowStep,
  serializedSize,
  WORKFLOW_TOOL_LIMITS,
} = await import("../dist/index.js");

const SERVER = "workflow-server";
const sessions = new Map([["session-a", "project-a"], ["session-b", "project-b"]]);

function context(overrides = {}) {
  return {
    terminalSessionId: "session-a",
    projectId: "project-a",
    scope: "write",
    connectionId: "connection-a",
    requestId: "request-a",
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** The workflow service, composed as a host composes it, and its MCP adapter. */
function service() {
  const store = new WorkflowStore();
  const typed = [];
  const registry = createWorkflowOperationRegistry({
    serverId: SERVER,
    templates: new WorkflowTemplateRepository(createMemoryWorkflowTemplateBackend()),
    store,
    eventJournal: new OrderedEventJournal(),
    sessionProject: (sessionId) => sessions.get(sessionId),
    typeText: (_request, target, text) => { typed.push([target.sessionId, text]); },
  });
  const unwrap = (outcome) =>
    typeof outcome === "object" && outcome !== null && "result" in outcome ? outcome.result : outcome;
  const adapter = createWorkflowControlAdapter({
    query: async (operation, payload, signal) =>
      unwrap(await registry.operations.queries[operation](mcpPrincipalQueryRequest(operation, payload, signal))),
    command: async (operation, payload, signal) =>
      unwrap(await registry.operations.commands[operation](mcpPrincipalCommandRequest(operation, payload, signal))),
    resolveTerminal: (ctx, reference) => {
      const projectId = sessions.get(reference);
      // Project reach: only the caller's own project.
      if (projectId === undefined || (ctx.reach !== "workspace" && projectId !== ctx.projectId))
        throw new ControlEndpointError("terminal_not_found", "The requested terminal is unavailable.");
      return { serverId: SERVER, projectId, sessionId: reference };
    },
  });
  const dispatch = createTerminalControlAdapter({
    adapter: { getMcpCapabilities: () => ({ tools: [] }) },
    workflows: adapter,
  });
  const call = (op, params = {}, ctx = context()) => dispatch({ id: "r", version: 1, op, params }, ctx);
  return { store, typed, call, dispatch };
}

const steps = [{ title: "Propose" }, { title: "Apply", prompt: "Implement it.", icon: "wrench" }];
const failure = (result, code) => {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, code);
  return result.error;
};

// 4.2 parsers

test("the parsers bound every field and keep the service's limits", () => {
  assert.deepEqual(
    Object.fromEntries(Object.keys(WORKFLOW_TOOL_LIMITS).map((key) => [key, WORKFLOW_LIMITS[key]])),
    { ...WORKFLOW_TOOL_LIMITS },
  );
  assert.deepEqual(parseGetWorkflow({}), {});
  assert.equal(parseGetWorkflow({ terminal: "" }).ok, false);
  assert.equal(parseCreateWorkflow({ name: "", steps }).ok, false);
  assert.equal(parseCreateWorkflow({ name: "Flow", steps: [] }).ok, false);
  assert.equal(parseCreateWorkflow({ name: "Flow", steps: Array.from({ length: 51 }, () => ({ title: "s" })) }).ok, false);
  assert.equal(parseCreateWorkflow({ name: "Flow", steps: [{ title: "t".repeat(121) }] }).ok, false);
  assert.equal(parseCreateWorkflow({ name: "Flow", steps, replace_workflow_id: "not an id" }).ok, false);
  assert.deepEqual(parseCreateWorkflow({ name: "Flow", steps, replace_workflow_id: "wf-1" }).replaceWorkflowId, "wf-1");
  assert.equal(parseUpdateWorkflowStep({ step_id: "step-1", status: "paused" }).ok, false);
  assert.equal(parseUpdateWorkflowStep({ step_id: "step-1", status: "done", note: "two\nlines" }).ok, false);
  assert.equal(parseUpdateWorkflowStep({ step_id: "step-1", status: "done", note: "x".repeat(201) }).ok, false);
  assert.deepEqual(parseUpdateWorkflowStep({ step_id: "step-1", status: "done", note: "" }), { stepId: "step-1", status: "done", note: "" });
});

// 4.2 adapter, and 4.1 codes reaching the agent with their ids

test("the tools default to the calling terminal and drive a workflow through its steps", async () => {
  const { call } = service();
  assert.deepEqual(await call("get_workflow"), { terminal: "session-a", workflow: null });
  const created = await call("create_workflow", { name: "Flow", opening_prompt: "Go.", steps });
  assert.equal(created.terminal, "session-a");
  assert.deepEqual(created.workflow.steps.map((step) => step.status), ["not_started", "not_started"]);
  const [first, second] = created.workflow.steps;
  await call("update_workflow_step", { step_id: first.id, status: "running" });
  const active = failure(await call("update_workflow_step", { step_id: second.id, status: "running" }), "step_active");
  assert.deepEqual(active.candidates, [first.id]);
  failure(await call("update_workflow_step", { step_id: "step-missing", status: "done" }), "step_not_found");
  const done = await call("update_workflow_step", { step_id: first.id, status: "done", note: "proposal written" });
  assert.equal(done.workflow.steps[0].note, "proposal written");
  assert.equal(done.resume_step_id, second.id);
  assert.equal(done.unfinished, true);
});

test("an unfinished workflow is replaced only when replace_workflow_id names it", async () => {
  const { call } = service();
  const created = await call("create_workflow", { name: "Flow", steps });
  const exists = failure(await call("create_workflow", { name: "Other", steps }), "workflow_exists");
  assert.deepEqual(exists.candidates, [created.workflow.id]);
  failure(await call("create_workflow", { name: "Other", steps, replace_workflow_id: "wf-stale" }), "workflow_exists");
  const replaced = await call("create_workflow", { name: "Other", steps, replace_workflow_id: created.workflow.id });
  assert.equal(replaced.workflow.name, "Other");
});

test("a terminal outside reach is not found, and its workflow is not disclosed", async () => {
  const { call } = service();
  await call("create_workflow", { name: "Theirs", steps, terminal: "session-b" }, context({ reach: "workspace" }));
  failure(await call("get_workflow", { terminal: "session-b" }), "terminal_not_found");
  failure(await call("update_workflow_step", { terminal: "session-b", step_id: "step-x", status: "done" }), "terminal_not_found");
  failure(await call("get_workflow", { terminal: "session-z" }), "terminal_not_found");
});

test("no_workflow reaches the agent unchanged", async () => {
  const { call } = service();
  failure(await call("update_workflow_step", { step_id: "step-1", status: "done" }), "no_workflow");
});

test("a chat must name a terminal; naming one within reach works", async () => {
  const { call } = service();
  const chat = context({ terminalSessionId: "chat:c1", projectId: "project-a", chat: { chatId: "c1" } });
  failure(await call("get_workflow", {}, chat), "bad_request");
  failure(await call("create_workflow", { name: "Flow", steps }, chat), "bad_request");
  const created = await call("create_workflow", { name: "Flow", steps, terminal: "session-a" }, chat);
  assert.equal(created.terminal, "session-a");
  assert.equal((await call("get_workflow", { terminal: "session-a" }, chat)).workflow.id, created.workflow.id);
});

// 4.3 groups and capabilities

test("get_workflow is Read Terminals; create and update are Full Terminal Management", () => {
  assert.equal(CONTROL_PERMISSION_GROUPS.get_workflow, "terminalsRead");
  assert.equal(CONTROL_PERMISSION_GROUPS.create_workflow, "terminalsManage");
  assert.equal(CONTROL_PERMISSION_GROUPS.update_workflow_step, "terminalsManage");
});

test("a project chat is offered the workflow tools, which need no calling terminal", async () => {
  const tools = ["get_workflow", "create_workflow", "update_workflow_step", "show_window"];
  const report = (workflows) =>
    createTerminalControlAdapter({
      adapter: { getMcpCapabilities: () => ({ tools: tools.map((tool) => ({ tool, available: true })) }) },
      ...(workflows
        ? { workflows: createWorkflowControlAdapter({ query: async () => null, command: async () => null, resolveTerminal: () => ({}) }) }
        : {}),
    });
  const chat = context({ terminalSessionId: "chat:c1", chat: { chatId: "c1" } });
  const available = (result) => Object.fromEntries((result.result ?? result).tools.map((entry) => [entry.tool, entry.available]));
  const offered = available(await report(true)({ id: "r", version: 1, op: "get_mcp_capabilities", params: {} }, chat));
  assert.deepEqual(offered, { get_workflow: true, create_workflow: true, update_workflow_step: true, show_window: false });
  const absent = available(await report(false)({ id: "r", version: 1, op: "get_mcp_capabilities", params: {} }, context()));
  assert.equal(absent.get_workflow, false);
});

// 4.4 the size bound fits the ordinary frames, end to end through stdio

function stepsOfSize(target, unit) {
  const list = Array.from({ length: 50 }, (_, index) => ({ title: `Step ${index}`, prompt: "", icon: "" }));
  const content = { name: "Sized", openingPrompt: "", steps: list };
  for (let index = 0; serializedSize(content) + Buffer.byteLength(JSON.stringify(unit)) <= target; index += 1) {
    const step = list[index % 50];
    if (Buffer.byteLength(step.prompt + unit) > WORKFLOW_TOOL_LIMITS.maxPromptBytes) continue;
    step.prompt += unit;
  }
  for (let at = 0; serializedSize(content) < target; at = (at + 1) % 50)
    if (Buffer.byteLength(list[at].prompt) < WORKFLOW_TOOL_LIMITS.maxPromptBytes) list[at].prompt += "a";
  assert.equal(serializedSize(content), target);
  return list;
}

async function withStdio(run) {
  const { dispatch } = service();
  const directory = await mkdtemp(join(tmpdir(), "terminay-workflow-tools-"));
  const socketPath = join(directory, "control.sock");
  const capabilities = new ControlCapabilityStore();
  const endpoint = createControlEndpoint({ socketPath, capabilities, dispatch, onError: () => {} });
  await endpoint.start();
  const lease = capabilities.mint("session-a", "project-a");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/mcpEntry.js", import.meta.url))],
    env: { ...process.env, TERMINAY_CONTROL_SOCKET: socketPath, TERMINAY_CONTROL_TOKEN: lease.token },
    stderr: "pipe",
  });
  const client = new Client({ name: "workflow-tools-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    await run(client);
  } finally {
    await client.close().catch(() => {});
    await endpoint.stop();
  }
}

const parsed = (result) => JSON.parse(result.content[0].text.slice(result.content[0].text.indexOf("\n") + 1));

test("a 56 KiB workflow of prose or of escapes travels in full, and 56 KiB + 1 byte is refused with its size", async () => {
  await withStdio(async (client) => {
    const limit = WORKFLOW_TOOL_LIMITS.maxSerializedBytes;
    let replace;
    for (const unit of ["plain prose. ", "\"\\\t\n\r\"\\"]) {
      const list = stepsOfSize(limit, unit);
      const created = await client.callTool({
        name: "create_workflow",
        arguments: { name: "Sized", steps: list, ...(replace === undefined ? {} : { replace_workflow_id: replace }) },
      });
      assert.notEqual(created.isError, true, created.content[0].text);
      replace = parsed(created).workflow.id;
      const read = parsed(await client.callTool({ name: "get_workflow", arguments: {} }));
      assert.deepEqual(read.workflow.steps.map((step) => step.prompt ?? ""), list.map((step) => step.prompt));
      const over = structuredClone(list);
      over[over.findIndex((step) => Buffer.byteLength(step.prompt) < WORKFLOW_TOOL_LIMITS.maxPromptBytes)].prompt += "a";
      const refused = await client.callTool({ name: "create_workflow", arguments: { name: "Sized", steps: over, replace_workflow_id: replace } });
      assert.equal(refused.isError, true);
      assert.match(refused.content[0].text, new RegExp(`${limit + 1} bytes`));
      assert.match(refused.content[0].text, /bad_request/);
    }
  });
});

test("a workflow refusal reaches the agent through stdio with its code and id", async () => {
  await withStdio(async (client) => {
    const created = parsed(await client.callTool({ name: "create_workflow", arguments: { name: "Flow", steps } }));
    const [first, second] = created.workflow.steps;
    await client.callTool({ name: "update_workflow_step", arguments: { step_id: first.id, status: "needs_input", note: "Which branch?" } });
    const refused = await client.callTool({ name: "update_workflow_step", arguments: { step_id: second.id, status: "running" } });
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /^step_active: /);
    assert.deepEqual(refused.structuredContent.error, { code: "step_active", message: refused.structuredContent.error.message, candidates: [first.id] });
    const exists = await client.callTool({ name: "create_workflow", arguments: { name: "Other", steps } });
    assert.match(exists.content[0].text, /^workflow_exists: /);
    assert.deepEqual(exists.structuredContent.error.candidates, [created.workflow.id]);
  });
});
