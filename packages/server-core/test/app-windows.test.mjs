import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_WINDOW_EVENTS,
  APP_WINDOW_OPERATIONS,
  AppWindowError,
  AppWindowService,
  MAX_AGENT_WINDOW_HTML_BYTES,
  MAX_APP_WINDOW_TEXT_BYTES,
  MAX_MCP_APP_RESOURCE_BYTES,
} from "../dist/index.js";

function journal() {
  const events = [];
  return {
    events,
    revision: 0,
    cursor: "0",
    append(event, payload) { events.push({ event, payload }); return { revision: events.length, cursor: String(events.length), event, payload }; },
    publishTransient() {},
  };
}

function service(overrides = {}) {
  const events = journal();
  const delivered = [];
  const viewRequests = [];
  let holder = "client-desktop";
  const windows = new AppWindowService({
    eventJournal: events,
    isPresentationHolder: (_window, context) => context.clientId === holder,
    deliverMessage: async (window, text) => { delivered.push({ terminal: window.terminalSessionId, text }); },
    viewRequest: async (window, method, params) => { viewRequests.push({ window: window.id, method, params }); return { ok: true }; },
    ...overrides,
  });
  return { windows, events, delivered, viewRequests, setHolder: (next) => { holder = next; } };
}

const agentWindow = (overrides = {}) => ({
  terminalSessionId: "session-1",
  projectId: "project-1",
  title: "Hello",
  source: { kind: "agent" },
  html: "<h1>Hello</h1>",
  ...overrides,
});

const context = (clientId = "client-desktop") => ({ clientId, connectionId: "c1", authScope: "write", signal: new AbortController().signal });
const command = (payload, clientId) => ({ envelope: { payload }, body: new Uint8Array(), context: context(clientId) });

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (error) => { assert.equal(error.code, code); return true; });
}

test("a new window starts open, minimises the session's others, and is listed oldest first", () => {
  let now = 1000;
  const { windows, events } = service({ now: () => now++ });
  const first = windows.open(agentWindow());
  assert.equal(first.state, "open");
  assert.deepEqual(first.source, { kind: "agent" });
  const second = windows.open(agentWindow({ title: "Second" }));
  assert.deepEqual(windows.list("session-1").map((w) => [w.title, w.state]), [["Hello", "minimised"], ["Second", "open"]]);
  assert.notEqual(first.id, second.id);
  assert.equal(events.events.at(-1).event, APP_WINDOW_EVENTS.changed);
  // The journal reaches every subscriber, so it carries no title or document.
  assert.deepEqual(Object.keys(events.events.at(-1).payload.windows[0]).sort(), ["contentRevision", "id", "state", "terminalSessionId"]);
});

test("a ninth window is refused and the eight are unchanged", () => {
  const { windows } = service();
  for (let index = 0; index < 8; index += 1) windows.open(agentWindow({ title: `W${index}` }));
  const before = windows.list("session-1");
  assert.throws(() => windows.open(agentWindow({ title: "Ninth" })), (error) => error instanceof AppWindowError && error.code === "window_limit");
  assert.deepEqual(windows.list("session-1"), before);
  // The bound is per session: another terminal can still open one.
  assert.equal(windows.open(agentWindow({ terminalSessionId: "session-2" })).state, "open");
});

test("documents and titles are bounded by source", () => {
  const { windows } = service();
  assert.throws(() => windows.open(agentWindow({ html: "x".repeat(MAX_AGENT_WINDOW_HTML_BYTES + 1) })), (error) => error.code === "window_too_large");
  // Multi-byte text is counted in bytes, not characters.
  assert.throws(() => windows.open(agentWindow({ html: "é".repeat(MAX_AGENT_WINDOW_HTML_BYTES / 2 + 1) })), (error) => error.code === "window_too_large");
  assert.throws(() => windows.open(agentWindow({ title: "t".repeat(81) })), (error) => error.code === "window_invalid");
  assert.throws(() => windows.open(agentWindow({ title: "   " })), (error) => error.code === "window_invalid");
  assert.throws(() => windows.open(agentWindow({ html: "" })), (error) => error.code === "window_invalid");
  const app = { kind: "mcp-app", server: "diagrams", tool: "draw", resourceUri: "ui://diagrams/draw" };
  assert.equal(windows.open(agentWindow({ source: app, html: "x".repeat(MAX_AGENT_WINDOW_HTML_BYTES + 1) })).state, "open");
  assert.throws(() => windows.open(agentWindow({ source: app, html: "x".repeat(MAX_MCP_APP_RESOURCE_BYTES + 1) })), (error) => error.code === "window_too_large");
  assert.equal(windows.list().length, 1);
});

test("a window is addressable only through the session that owns it", () => {
  const { windows } = service();
  const mine = windows.open(agentWindow());
  assert.equal(windows.close("session-2", mine.id), false);
  assert.throws(() => windows.replace("session-2", mine.id, { title: "x", html: "<p>x</p>" }), (error) => error.code === "window_not_found");
  assert.equal(windows.list("session-2").length, 0);
  assert.equal(windows.list("session-1").length, 1);
  assert.equal(windows.close("session-1", mine.id), true);
  assert.equal(windows.list().length, 0);
});

test("replace updates an agent window in place and restores it; an MCP App window cannot be replaced", () => {
  const { windows } = service();
  const first = windows.open(agentWindow());
  const app = windows.open(agentWindow({ title: "Draw", source: { kind: "mcp-app", server: "diagrams", tool: "draw", resourceUri: "ui://d" } }));
  const replaced = windows.replace("session-1", first.id, { title: "Hello again", html: "<h1>2</h1>" });
  assert.equal(replaced.id, first.id);
  assert.equal(replaced.title, "Hello again");
  assert.equal(replaced.state, "open");
  assert.equal(replaced.contentRevision, first.contentRevision + 1);
  assert.equal(windows.list("session-1").find((w) => w.id === app.id).state, "minimised");
  assert.equal(windows.list("session-1").length, 2);
  assert.throws(() => windows.replace("session-1", app.id, { title: "x", html: "<p>x</p>" }), (error) => error.code === "window_invalid");
});

test("a session's windows end with it and leave other sessions alone", () => {
  const { windows } = service();
  windows.open(agentWindow());
  windows.open(agentWindow({ title: "Two" }));
  const other = windows.open(agentWindow({ terminalSessionId: "session-2" }));
  windows.endSession("session-1");
  assert.deepEqual(windows.list().map((w) => w.id), [other.id]);
  windows.endAll();
  assert.equal(windows.list().length, 0);
});

test("content is served with the document as the body and reflects the tool result", async () => {
  const { windows } = service();
  const app = windows.open(agentWindow({
    title: "Draw",
    source: { kind: "mcp-app", server: "diagrams", tool: "draw", resourceUri: "ui://d" },
    html: "<p>view</p>",
    csp: { connectDomains: ["https://api.example"] },
    tool: { name: "draw" },
    toolInput: { shape: "circle" },
  }));
  const { queries } = windows.operations();
  const before = await queries[APP_WINDOW_OPERATIONS.content](command({ windowId: app.id }));
  assert.equal(new TextDecoder().decode(before.body), "<p>view</p>");
  assert.deepEqual(before.result.toolInput, { shape: "circle" });
  assert.deepEqual(before.result.csp, { connectDomains: ["https://api.example"] });
  assert.equal("toolResult" in before.result, false);
  windows.setToolResult(app.id, { content: [{ type: "text", text: "done" }] });
  const after = await queries[APP_WINDOW_OPERATIONS.content](command({ windowId: app.id }));
  assert.deepEqual(after.result.toolResult, { content: [{ type: "text", text: "done" }] });
  assert.equal(after.result.window.contentRevision, before.result.window.contentRevision + 1);
  windows.setToolCancelled(app.id, "upstream failed");
  const cancelled = await queries[APP_WINDOW_OPERATIONS.content](command({ windowId: app.id }));
  assert.equal(cancelled.result.toolCancelled, "upstream failed");
  await rejectsWith(queries[APP_WINDOW_OPERATIONS.content](command({ windowId: "win_missing" })), "not_found");
  await rejectsWith(queries[APP_WINDOW_OPERATIONS.content](command({ windowId: 7 })), "validation");
});

test("opening a window through the protocol minimises the others; closing removes it", async () => {
  const { windows } = service();
  const first = windows.open(agentWindow());
  const second = windows.open(agentWindow({ title: "Two" }));
  const { commands } = windows.operations();
  await commands[APP_WINDOW_OPERATIONS.setState](command({ windowId: first.id, state: "open" }));
  assert.deepEqual(windows.list("session-1").map((w) => w.state), ["open", "minimised"]);
  await commands[APP_WINDOW_OPERATIONS.setState](command({ windowId: first.id, state: "minimised" }));
  assert.deepEqual(windows.list("session-1").map((w) => w.state), ["minimised", "minimised"]);
  await rejectsWith(commands[APP_WINDOW_OPERATIONS.setState](command({ windowId: first.id, state: "floating" })), "validation");
  await commands[APP_WINDOW_OPERATIONS.close](command({ windowId: second.id }));
  assert.deepEqual(windows.list("session-1").map((w) => w.id), [first.id]);
});

test("a view's message is delivered to the owning terminal only from the presentation holder, then the window minimises", async () => {
  const { windows, delivered } = service();
  const window = windows.open(agentWindow());
  const { commands } = windows.operations();
  await rejectsWith(commands[APP_WINDOW_OPERATIONS.message](command({ windowId: window.id, text: "hi" }, "client-phone")), "forbidden");
  assert.deepEqual(delivered, []);
  assert.equal(windows.list("session-1")[0].state, "open");
  await commands[APP_WINDOW_OPERATIONS.message](command({ windowId: window.id, text: "Deploy api to eu-west-1" }));
  assert.deepEqual(delivered, [{ terminal: "session-1", text: "Deploy api to eu-west-1" }]);
  assert.equal(windows.list("session-1")[0].state, "minimised");
});

test("empty and oversized messages are rejected and nothing is delivered", async () => {
  const { windows, delivered } = service();
  const window = windows.open(agentWindow());
  const { commands } = windows.operations();
  await rejectsWith(commands[APP_WINDOW_OPERATIONS.message](command({ windowId: window.id, text: "" })), "validation");
  await rejectsWith(commands[APP_WINDOW_OPERATIONS.message](command({ windowId: window.id, text: "x".repeat(MAX_APP_WINDOW_TEXT_BYTES + 1) })), "validation");
  await rejectsWith(commands[APP_WINDOW_OPERATIONS.message](command({ windowId: window.id })), "validation");
  assert.deepEqual(delivered, []);
});

test("a refused message leaves the window open", async () => {
  const { windows } = service({ deliverMessage: async () => { throw Object.assign(new Error("Window Messages is set to Never Allow"), { code: "forbidden" }); } });
  const window = windows.open(agentWindow());
  const { commands } = windows.operations();
  await rejectsWith(commands[APP_WINDOW_OPERATIONS.message](command({ windowId: window.id, text: "hi" })), "forbidden");
  assert.equal(windows.list("session-1")[0].state, "open");
});

test("model context is delivered once, the latest update wins, and it stays with its terminal", async () => {
  const { windows } = service();
  const window = windows.open(agentWindow({ title: "Picker" }));
  windows.open(agentWindow({ terminalSessionId: "session-2", title: "Other" }));
  const { commands } = windows.operations();
  await rejectsWith(commands[APP_WINDOW_OPERATIONS.context](command({ windowId: window.id, text: "first" }, "client-phone")), "forbidden");
  await commands[APP_WINDOW_OPERATIONS.context](command({ windowId: window.id, text: "first" }));
  await commands[APP_WINDOW_OPERATIONS.context](command({ windowId: window.id, text: "second" }));
  assert.deepEqual(windows.takeModelContext("session-2"), []);
  assert.deepEqual(windows.takeModelContext("session-1"), [{ title: "Picker", text: "second" }]);
  assert.deepEqual(windows.takeModelContext("session-1"), []);
});

test("only an MCP App view held by the presentation holder can reach its server", async () => {
  const { windows, viewRequests, setHolder } = service();
  const agent = windows.open(agentWindow());
  const app = windows.open(agentWindow({ title: "Draw", source: { kind: "mcp-app", server: "diagrams", tool: "draw", resourceUri: "ui://d" } }));
  const { commands } = windows.operations();
  const call = { method: "tools/call", params: { name: "poll", arguments: {} } };
  await rejectsWith(commands[APP_WINDOW_OPERATIONS.viewRequest](command({ windowId: agent.id, ...call })), "forbidden");
  await rejectsWith(commands[APP_WINDOW_OPERATIONS.viewRequest](command({ windowId: app.id, ...call }, "client-phone")), "forbidden");
  await rejectsWith(commands[APP_WINDOW_OPERATIONS.viewRequest](command({ windowId: app.id, method: "prompts/get", params: {} })), "validation");
  assert.deepEqual(viewRequests, []);
  assert.deepEqual(await commands[APP_WINDOW_OPERATIONS.viewRequest](command({ windowId: app.id, ...call })), { response: { ok: true } });
  assert.deepEqual(viewRequests, [{ window: app.id, method: "tools/call", params: call.params }]);
  // After a takeover the new holder speaks for the view and the old one cannot.
  setHolder("client-phone");
  await rejectsWith(commands[APP_WINDOW_OPERATIONS.viewRequest](command({ windowId: app.id, ...call })), "forbidden");
  await commands[APP_WINDOW_OPERATIONS.viewRequest](command({ windowId: app.id, ...call }, "client-phone"));
  assert.equal(viewRequests.length, 2);
});

test("listing needs only read authority; everything else needs write", () => {
  const { policies } = service().windows.operations();
  assert.deepEqual(policies[APP_WINDOW_OPERATIONS.list], { scope: "read" });
  for (const operation of Object.values(APP_WINDOW_OPERATIONS))
    if (operation !== APP_WINDOW_OPERATIONS.list) assert.deepEqual(policies[operation], { scope: "write" }, operation);
});
