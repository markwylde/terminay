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
  parseCreateWorkflowTemplate,
  parseGetWorkflow,
  parseTemplateId,
  parseUpdateWorkflowTemplate,
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
function service({ beforeCommand } = {}) {
  const store = new WorkflowStore();
  const typed = [];
  const templates = new WorkflowTemplateRepository(createMemoryWorkflowTemplateBackend());
  const registry = createWorkflowOperationRegistry({
    serverId: SERVER,
    templates,
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
    command: async (operation, payload, signal, expectedRevision) => {
      await beforeCommand?.(operation);
      return unwrap(
        await registry.operations.commands[operation](
          mcpPrincipalCommandRequest(operation, payload, signal, expectedRevision),
        ),
      );
    },
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
  return { store, typed, call, dispatch, templates };
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
  failure(await call("get_workflow"), "no_workflow");
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
  // An agent reading back gets every step's icon and times.
  const read = await call("get_workflow");
  assert.equal(read.workflow.steps[1].icon, "wrench");
  assert.equal("icon" in read.workflow.steps[0], false);
  assert.match(read.workflow.steps[0].started_at, /^\d{4}-\d\d-\d\dT/);
  assert.match(read.workflow.steps[0].ended_at, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual([read.workflow.steps[1].started_at, read.workflow.steps[1].ended_at], [null, null]);
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
    const none = await client.callTool({ name: "get_workflow", arguments: {} });
    assert.equal(none.isError, true);
    assert.match(none.content[0].text, /^no_workflow: /);
    const created = parsed(await client.callTool({ name: "create_workflow", arguments: { name: "Flow", steps } }));
    const [first, second] = created.workflow.steps;
    const roundTrip = parsed(await client.callTool({ name: "get_workflow", arguments: {} }));
    assert.equal(roundTrip.workflow.steps[1].icon, "wrench");
    assert.deepEqual([roundTrip.workflow.steps[0].started_at, roundTrip.workflow.steps[0].ended_at], [null, null]);
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

// Workflow templates over MCP (mcp-workflow-templates)

const templateSteps = [{ title: "Review" }, { title: "Fix", prompt: "Fix the findings.", icon: "bug" }];

test("the template parsers bound their fields and keep template_id apart from inline content", () => {
  assert.equal(parseTemplateId({ template_id: "not an id" }).ok, false);
  assert.deepEqual(parseTemplateId({ template_id: "tpl-1" }), { templateId: "tpl-1" });
  assert.equal(parseCreateWorkflowTemplate({ name: "T", steps: [] }).ok, false);
  assert.equal(parseCreateWorkflowTemplate({ name: "T", steps: templateSteps, category: "two\nlines" }).ok, false);
  assert.equal(parseCreateWorkflowTemplate({ name: "T", steps: templateSteps, category: "c".repeat(65) }).ok, false);
  assert.equal(parseCreateWorkflowTemplate({ name: "T", steps: templateSteps, description: "d".repeat(1025) }).ok, false);
  assert.deepEqual(parseCreateWorkflowTemplate({ name: "T", steps: templateSteps, category: "  Shipping " }).category, "Shipping");
  assert.equal(parseUpdateWorkflowTemplate({ template_id: "tpl-1" }).ok, false);
  assert.deepEqual(parseUpdateWorkflowTemplate({ template_id: "tpl-1", description: "" }), { templateId: "tpl-1", description: "" });
  assert.equal(parseUpdateWorkflowTemplate({ template_id: "tpl-1", steps: [{ id: "bad id", title: "x" }] }).ok, false);
  assert.deepEqual(parseCreateWorkflow({ template_id: "tpl-1" }), { templateId: "tpl-1" });
  assert.equal(parseCreateWorkflow({ template_id: "tpl-1", steps }).ok, false);
  assert.equal(parseCreateWorkflow({ template_id: "tpl-1", name: "Flow" }).ok, false);
});

test("an agent creates, reads, updates, lists, and deletes a template, which never touches a terminal", async () => {
  const { call, templates, typed, store } = service();
  const created = await call("create_workflow_template", {
    name: "Review",
    category: "Quality",
    description: "Review then fix.",
    opening_prompt: "Review the branch.",
    steps: templateSteps,
  });
  const id = created.template.id;
  assert.match(id, /^tpl-/);
  assert.equal(created.template.category, "Quality");
  assert.deepEqual(created.template.steps.map((step) => step.title), ["Review", "Fix"]);
  assert.equal("status" in created.template.steps[0], false);
  assert.equal(store.get("session-a"), undefined);
  assert.deepEqual(typed, []);

  const listed = await call("list_workflow_templates");
  assert.deepEqual(listed.categories, ["Quality"]);
  assert.deepEqual(listed.templates, [{ id, name: "Review", description: "Review then fix.", category: "Quality", step_count: 2 }]);

  // A partial update keeps every other field; a retitled step keeps its id.
  const read = await call("get_workflow_template", { template_id: id });
  const [review, fix] = read.template.steps;
  const described = await call("update_workflow_template", { template_id: id, description: "Changed." });
  assert.equal(described.template.description, "Changed.");
  assert.equal(described.template.opening_prompt, "Review the branch.");
  assert.deepEqual(described.template.steps.map((step) => step.id), [review.id, fix.id]);
  const retitled = await call("update_workflow_template", {
    template_id: id,
    steps: [{ id: review.id, title: "Review" }, { id: fix.id, title: "Fix it", prompt: fix.prompt, icon: fix.icon }, { title: "Ship" }],
  });
  assert.deepEqual(retitled.template.steps.slice(0, 2).map((step) => step.id), [review.id, fix.id]);
  assert.equal(retitled.template.steps[1].title, "Fix it");
  assert.notEqual(retitled.template.steps[2].id, review.id);

  // Categories are matched by name, ignoring case.
  const moved = await call("update_workflow_template", { template_id: id, category: "quality" });
  assert.equal(moved.template.category, "Quality");
  assert.deepEqual((await templates.load()).categories, ["Quality"]);

  const deleted = await call("delete_workflow_template", { template_id: id });
  assert.deepEqual(deleted, { deleted: id, name: "Review" });
  assert.deepEqual((await templates.load()).templates, []);
  assert.deepEqual((await templates.load()).categories, ["Quality"]);
});

test("an unknown template id is template_not_found and creates nothing", async () => {
  const { call, templates } = service();
  for (const [op, params] of [
    ["get_workflow_template", {}],
    ["update_workflow_template", { name: "New" }],
    ["delete_workflow_template", {}],
    ["create_workflow", {}],
  ]) {
    const error = failure(await call(op, { template_id: "tpl-missing", ...params }), "template_not_found");
    assert.deepEqual(error.candidates, ["tpl-missing"], op);
  }
  assert.deepEqual((await templates.load()).templates, []);
});

test("an invalid template is bad_request and nothing is saved", async () => {
  const { call, templates } = service();
  failure(await call("create_workflow_template", { name: "T", steps: [{ title: " " }] }), "bad_request");
  assert.deepEqual((await templates.load()).templates, []);
});

test("an update retries over a concurrent edit and keeps both", async () => {
  let interfere;
  const { call, templates } = service({ beforeCommand: async () => { await interfere?.(); } });
  const a = (await call("create_workflow_template", { name: "A", steps: templateSteps })).template;
  const b = (await call("create_workflow_template", { name: "B", steps: templateSteps })).template;
  // A user saves template A in Settings between the agent's read and write.
  interfere = async () => {
    interfere = undefined;
    const stored = (await templates.load()).templates.find((item) => item.id === a.id);
    await templates.apply({ command: { type: "upsert", template: { ...stored, name: "A from Settings" } } });
  };
  const updated = await call("update_workflow_template", { template_id: b.id, name: "B from agent" });
  assert.equal(updated.template.name, "B from agent");
  const names = (await templates.load()).templates.map((item) => item.name);
  assert.deepEqual(names, ["A from Settings", "B from agent"]);
});

test("an update of a template deleted meanwhile does not re-create it", async () => {
  let interfere;
  const { call, templates } = service({ beforeCommand: async () => { await interfere?.(); } });
  const a = (await call("create_workflow_template", { name: "A", steps: templateSteps })).template;
  interfere = async () => {
    interfere = undefined;
    await templates.apply({ command: { type: "remove", templateId: a.id } });
  };
  failure(await call("update_workflow_template", { template_id: a.id, name: "Back" }), "template_not_found");
  assert.deepEqual((await templates.load()).templates, []);
});

test("create_workflow copies a template into the terminal and types nothing", async () => {
  const { call, typed, templates } = service();
  const template = (await call("create_workflow_template", { name: "Review", opening_prompt: "Go.", steps: templateSteps })).template;
  const created = await call("create_workflow", { template_id: template.id });
  assert.equal(created.workflow.name, "Review");
  assert.equal(created.workflow.opening_prompt, "Go.");
  assert.equal(created.workflow.template_id, template.id);
  assert.deepEqual(created.workflow.steps.map((step) => [step.title, step.status]), [["Review", "not_started"], ["Fix", "not_started"]]);
  assert.equal(created.workflow.steps.some((step, index) => step.id === template.steps[index].id), false);
  assert.deepEqual(typed, []);
  // Later edits to the template leave the workflow alone, and step reports leave the template alone.
  await call("update_workflow_template", { template_id: template.id, steps: [{ title: "Renamed" }] });
  await call("update_workflow_step", { step_id: created.workflow.steps[0].id, status: "done" });
  const read = await call("get_workflow");
  assert.equal(read.workflow.steps[0].title, "Review");
  assert.deepEqual((await templates.load()).templates[0].steps.map((step) => step.title), ["Renamed"]);
  // An inline workflow records no template.
  const inline = await call("create_workflow", { name: "Flow", steps, replace_workflow_id: created.workflow.id });
  assert.equal(inline.workflow.template_id, null);
  // template_id with steps is refused before anything changes.
  failure(await call("create_workflow", { template_id: template.id, steps, replace_workflow_id: inline.workflow.id }), "bad_request");
  assert.equal((await call("get_workflow")).workflow.id, inline.workflow.id);
});

test("template reads are Read Terminals and writes are Workflow Templates, from either reach", async () => {
  for (const op of ["list_workflow_templates", "get_workflow_template"])
    assert.equal(CONTROL_PERMISSION_GROUPS[op], "terminalsRead", op);
  for (const op of ["create_workflow_template", "update_workflow_template", "delete_workflow_template"])
    assert.equal(CONTROL_PERMISSION_GROUPS[op], "workflowTemplates", op);
  const { call } = service();
  // A project-reach terminal and a project chat may both save templates.
  const created = await call("create_workflow_template", { name: "T", steps: templateSteps }, context({ reach: "project" }));
  assert.match(created.template.id, /^tpl-/);
  const chat = context({ terminalSessionId: "chat:c1", chat: { chatId: "c1" } });
  assert.equal((await call("list_workflow_templates", {}, chat)).templates.length, 1);
});

test("template_not_found reaches the agent through stdio, and every description names its noun", async () => {
  await withStdio(async (client) => {
    const missing = await client.callTool({ name: "delete_workflow_template", arguments: { template_id: "tpl-gone" } });
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /^template_not_found: /);
    assert.deepEqual(missing.structuredContent.error.candidates, ["tpl-gone"]);
    const { tools } = await client.listTools();
    const description = (name) => tools.find((tool) => tool.name === name).description;
    for (const name of ["list_workflow_templates", "get_workflow_template", "create_workflow_template", "update_workflow_template", "delete_workflow_template"])
      assert.match(description(name), /^A workflow template is a reusable definition/, name);
    for (const name of ["get_workflow", "create_workflow", "update_workflow_step"])
      assert.match(description(name), /^A workflow is the one checklist attached to a single terminal/, name);
    assert.equal(tools.filter((tool) => /workflow/.test(tool.name) && !/workflow_template/.test(tool.name)).every((tool) => !/template/.test(tool.name)), true);
  });
});

// skip-workflow-steps

test("an agent skips a step with a reason, and a workflow of done and skipped steps is finished", async () => {
  const { call } = service();
  assert.deepEqual(parseUpdateWorkflowStep({ step_id: "step-1", status: "skipped", note: "n/a" }), { stepId: "step-1", status: "skipped", note: "n/a" });
  const created = await call("create_workflow", { name: "Flow", opening_prompt: "Go.", steps });
  const [first, second] = created.workflow.steps;
  await call("update_workflow_step", { step_id: first.id, status: "done", note: "ok" });
  const skipped = await call("update_workflow_step", { step_id: second.id, status: "skipped", note: "not a visual change" });
  assert.equal(skipped.workflow.steps[1].status, "skipped");
  assert.equal(skipped.workflow.steps[1].note, "not a visual change");
  assert.equal(skipped.unfinished, false);
  assert.equal(skipped.resume_step_id, null);
  const read = await call("get_workflow");
  assert.equal(read.workflow.steps[1].status, "skipped");
});
