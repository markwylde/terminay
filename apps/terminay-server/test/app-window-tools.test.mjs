import test from "node:test"
import assert from "node:assert/strict"
import {
  AppWindowService,
  DEFAULT_MCP_PERMISSIONS,
  MAX_AGENT_WINDOW_HTML_BYTES,
  McpApprovalService,
} from "@terminay/server-core"

const {
  CONTROL_PERMISSION_GROUPS,
  MAX_CONNECTED_TOOL_RESULT_BYTES,
  createAppWindowControlAdapter,
  createMcpPermissionGate,
  createTerminalControlAdapter,
} = await import("../dist/index.js")

function context(overrides = {}) {
  return {
    terminalSessionId: "session-1",
    projectId: "project-a",
    scope: "write",
    connectionId: "connection-1",
    requestId: "request-1",
    signal: new AbortController().signal,
    ...overrides,
  }
}

const UI = { entry: "diagrams", tool: "draw", resourceUri: "ui://diagrams/draw", title: "Draw a diagram", definition: { name: "draw" } }

function fakeGateway(overrides = {}) {
  const calls = []
  return {
    calls,
    listTools: async (projectId) => { calls.push(["list", projectId]); return [{ name: "diagrams__draw", description: "Draw", inputSchema: { type: "object" } }] },
    toolUi: async (_projectId, name) => {
      if (name === "diagrams__draw") return UI
      if (name === "diagrams__plain") return undefined
      throw Object.assign(new Error(`Unknown tool ${name}`), { code: "not_found" })
    },
    callTool: async (projectId, name, args) => { calls.push(["call", projectId, name, args]); return { content: [{ type: "text", text: "drawn" }], structuredContent: { shapes: 1 } } },
    readUiResource: async () => ({ html: "<p>view</p>", mimeType: "text/html;profile=mcp-app", csp: { connectDomains: ["https://api.example"] } }),
    revision: () => "rev-1",
    onChanged: () => () => {},
    ...overrides,
  }
}

function setup({ policies = {}, gateway = fakeGateway(), withContext = true } = {}) {
  const windows = new AppWindowService({ isPresentationHolder: () => true })
  const approvals = new McpApprovalService({ policies: { ...DEFAULT_MCP_PERMISSIONS, ...policies } })
  const dispatch = createTerminalControlAdapter({
    adapter: {},
    appWindows: createAppWindowControlAdapter({ windows, ...(gateway === null ? {} : { gateway }) }),
    ...(withContext ? { takeModelContext: (ctx, maxBytes) => windows.takeModelContext(ctx.terminalSessionId, maxBytes) } : {}),
    permissions: createMcpPermissionGate({
      approvals,
      describe: async () => ({ agent: "Claude Code", terminalTitle: "Terminal 1", summary: "show a window", details: [] }),
    }),
  })
  const call = (op, params = {}, ctx = context()) => dispatch({ id: "r", version: 1, op, params }, ctx)
  return { windows, approvals, gateway, call }
}

test("the window tools and connected tools have their own permission groups", () => {
  assert.equal(CONTROL_PERMISSION_GROUPS.show_window, "appWindows")
  assert.equal(CONTROL_PERMISSION_GROUPS.close_window, "appWindows")
  assert.equal(CONTROL_PERMISSION_GROUPS.list_windows, "appWindows")
  assert.equal(CONTROL_PERMISSION_GROUPS.call_connected_tool, "connectedServerTools")
  // Listing never prompts.
  assert.equal(CONTROL_PERMISSION_GROUPS.list_connected_tools, undefined)
})

test("show_window opens a hello world window in the calling terminal and returns its handle", async () => {
  const { windows, call } = setup()
  const result = await call("show_window", { title: "Hello", html: "<h1>Hello world</h1>" })
  assert.match(result.window, /^win_/)
  assert.equal(result.state, "open")
  const [window] = windows.list("session-1")
  assert.equal(window.id, result.window)
  assert.equal(window.title, "Hello")
  assert.deepEqual(window.source, { kind: "agent" })
  assert.equal(windows.list("session-2").length, 0)
})

test("show_window with a handle updates that window in place", async () => {
  const { windows, call } = setup()
  const first = await call("show_window", { title: "Hello", html: "<h1>1</h1>" })
  const second = await call("show_window", { title: "Hello 2", html: "<h1>2</h1>", window: first.window })
  assert.equal(second.window, first.window)
  assert.deepEqual(windows.list("session-1").map((w) => w.title), ["Hello 2"])
})

test("an oversized document, a bad title, and a ninth window are refused without creating anything", async () => {
  const { windows, call } = setup()
  const tooLarge = await call("show_window", { title: "Big", html: "x".repeat(MAX_AGENT_WINDOW_HTML_BYTES + 1) })
  assert.equal(tooLarge.error.code, "limit_exceeded")
  assert.equal((await call("show_window", { title: "", html: "<p>x</p>" })).error.code, "bad_request")
  assert.equal((await call("show_window", { title: "t".repeat(81), html: "<p>x</p>" })).error.code, "bad_request")
  assert.equal((await call("show_window", { title: "T" })).error.code, "bad_request")
  assert.equal(windows.list().length, 0)
  for (let index = 0; index < 8; index += 1) await call("show_window", { title: `W${index}`, html: "<p>x</p>" })
  assert.equal((await call("show_window", { title: "Ninth", html: "<p>x</p>" })).error.code, "limit_exceeded")
  assert.equal(windows.list("session-1").length, 8)
})

test("a handle from another terminal is not found by close_window or show_window", async () => {
  const { windows, call } = setup()
  const mine = await call("show_window", { title: "Mine", html: "<p>x</p>" })
  const other = context({ terminalSessionId: "session-2" })
  assert.equal((await call("close_window", { window: mine.window }, other)).error.code, "not_found")
  assert.equal((await call("show_window", { title: "Hijack", html: "<p>y</p>", window: mine.window }, other)).error.code, "not_found")
  assert.deepEqual(windows.list("session-1").map((w) => w.title), ["Mine"])
  assert.deepEqual(await call("close_window", { window: mine.window }), { window: mine.window, closed: true })
  assert.equal((await call("close_window", { window: "not a handle" })).error.code, "bad_request")
})

test("a window store from another copy of server-core still reports its errors by name and code", async () => {
  // Desktop composes the store from source while this adapter is built against
  // dist, so the error class differs; the mapping must not rely on it.
  const foreign = (code, message) => Object.assign(new Error(message), { name: "AppWindowError", code })
  const adapter = createAppWindowControlAdapter({
    windows: {
      open: () => { throw foreign("window_limit", "This terminal already has 8 windows.") },
      replace: () => { throw foreign("window_not_found", "This terminal has no window with that handle.") },
      close: () => false,
      list: () => [],
      setToolResult: () => {},
      setToolCancelled: () => {},
    },
  })
  assert.equal((await adapter.showWindow({ title: "T", html: "<p>x</p>" }, context())).error.code, "limit_exceeded")
  assert.equal((await adapter.showWindow({ title: "T", html: "<p>x</p>", window: "win_x" }, context())).error.code, "not_found")
  // Anything else is not the store's to explain and is not swallowed.
  const broken = createAppWindowControlAdapter({ windows: { open: () => { throw new Error("disk on fire") } } })
  assert.throws(() => broken.showWindow({ title: "T", html: "<p>x</p>" }, context()), /disk on fire/)
})

test("list_windows returns only the calling terminal's windows with handle, title, source, and state", async () => {
  const { call } = setup()
  const agent = await call("show_window", { title: "Notes", html: "<p>x</p>" })
  await call("call_connected_tool", { name: "diagrams__draw", arguments: { shape: "circle" } })
  await call("show_window", { title: "Elsewhere", html: "<p>x</p>" }, context({ terminalSessionId: "session-2" }))
  const { windows } = await call("list_windows")
  assert.deepEqual(windows.map((w) => [w.title, w.source, w.state]), [
    ["Notes", "agent", "minimised"],
    ["Draw a diagram", "diagrams__draw", "open"],
  ])
  assert.equal(windows[0].window, agent.window)
})

test("Never Allow for App Windows refuses show_window", async () => {
  const { windows, call } = setup({ policies: { appWindows: "deny" } })
  assert.equal((await call("show_window", { title: "Hello", html: "<p>x</p>" })).error.code, "permission_denied")
  assert.equal(windows.list().length, 0)
})

test("a connected tool with a UI opens a window, gives the view its input and result, and tells the agent", async () => {
  const { windows, gateway, call } = setup()
  const result = await call("call_connected_tool", { name: "diagrams__draw", arguments: { shape: "circle" } })
  assert.deepEqual(gateway.calls, [["call", "project-a", "diagrams__draw", { shape: "circle" }]])
  assert.match(result.content[0].text, /"Draw a diagram" is open as an interactive view/)
  assert.deepEqual(result.content[1], { type: "text", text: "drawn" })
  assert.deepEqual(result.structuredContent, { shapes: 1 })
  const [window] = windows.list("session-1")
  assert.deepEqual(window.source, { kind: "mcp-app", server: "diagrams", tool: "draw", resourceUri: "ui://diagrams/draw" })
  const { queries } = windows.operations()
  const content = await queries["app-windows.content"]({ envelope: { payload: { windowId: window.id } }, context: {} })
  const data = JSON.parse(new TextDecoder().decode(content.body))
  assert.equal(data.html, "<p>view</p>")
  assert.deepEqual(data.toolInput, { shape: "circle" })
  assert.deepEqual(data.toolResult.structuredContent, { shapes: 1 })
  assert.deepEqual(content.result.csp, { connectDomains: ["https://api.example"] })
})

test("a connected tool without a UI returns its result unchanged and opens nothing", async () => {
  const { windows, call } = setup()
  const result = await call("call_connected_tool", { name: "diagrams__plain", arguments: {} })
  assert.deepEqual(result, { content: [{ type: "text", text: "drawn" }], structuredContent: { shapes: 1 } })
  assert.equal(windows.list().length, 0)
})

test("with App Windows denied the tool still runs and no window opens", async () => {
  const { windows, gateway, call } = setup({ policies: { appWindows: "deny" } })
  const result = await call("call_connected_tool", { name: "diagrams__draw", arguments: {} })
  assert.deepEqual(result.content, [{ type: "text", text: "drawn" }])
  assert.equal(gateway.calls.length, 1)
  assert.equal(windows.list().length, 0)
})

test("with Connected Server Tools denied the tool does not run", async () => {
  const { windows, gateway, call } = setup({ policies: { connectedServerTools: "deny" } })
  assert.equal((await call("call_connected_tool", { name: "diagrams__draw", arguments: {} })).error.code, "permission_denied")
  assert.equal(gateway.calls.length, 0)
  assert.equal(windows.list().length, 0)
})

test("a wrong content type or an oversized resource opens no window and the tool still runs", async () => {
  for (const resource of [
    { html: "<p>x</p>", mimeType: "text/html" },
    // A resource that does not say what it is is not an MCP App view.
    { html: "<p>x</p>" },
    { html: "x".repeat(4 * 1024 * 1024 + 1), mimeType: "text/html;profile=mcp-app" },
  ]) {
    const gateway = fakeGateway({ readUiResource: async () => resource })
    const { windows, call } = setup({ gateway })
    const result = await call("call_connected_tool", { name: "diagrams__draw", arguments: {} })
    assert.deepEqual(result.content, [{ type: "text", text: "drawn" }])
    assert.equal(windows.list().length, 0)
  }
})

test("a failing tool tells its view it was cancelled and the agent gets the error", async () => {
  const gateway = fakeGateway({ callTool: async () => { throw new Error("upstream exploded") } })
  const { windows, call } = setup({ gateway })
  const result = await call("call_connected_tool", { name: "diagrams__draw", arguments: {} })
  assert.equal(result.ok, false)
  const [window] = windows.list("session-1")
  const { queries } = windows.operations()
  const content = await queries["app-windows.content"]({ envelope: { payload: { windowId: window.id } }, context: {} })
  assert.equal(JSON.parse(new TextDecoder().decode(content.body)).toolCancelled, "upstream exploded")
})

test("a result over 1 MiB is replaced by a bounded error naming the tool", async () => {
  const gateway = fakeGateway({ callTool: async () => ({ content: [{ type: "text", text: "x".repeat(MAX_CONNECTED_TOOL_RESULT_BYTES) }] }) })
  const { call } = setup({ gateway })
  const result = await call("call_connected_tool", { name: "diagrams__plain", arguments: {} })
  assert.equal(result.error.code, "limit_exceeded")
  assert.match(result.error.message, /diagrams__plain/)
})

test("a result over 1 MiB never reaches its view either: the view is told the call failed", async () => {
  const gateway = fakeGateway({ callTool: async () => ({ content: [{ type: "text", text: "x".repeat(MAX_CONNECTED_TOOL_RESULT_BYTES) }] }) })
  const { windows, call } = setup({ gateway })
  const result = await call("call_connected_tool", { name: "diagrams__draw", arguments: {} })
  assert.equal(result.error.code, "limit_exceeded")
  const [window] = windows.list()
  const content = await windows.operations().queries["app-windows.content"]({ envelope: { payload: { windowId: window.id } }, context: {} })
  const data = JSON.parse(new TextDecoder().decode(content.body))
  assert.equal("toolResult" in data, false)
  assert.match(data.toolCancelled, /larger than 1 MiB/)
})

test("connected tools are listed for the calling project; with no gateway there are none and calls are unsupported", async () => {
  const { gateway, call } = setup()
  assert.deepEqual((await call("list_connected_tools")).tools.map((tool) => tool.name), ["diagrams__draw"])
  assert.deepEqual(gateway.calls, [["list", "project-a"]])
  const bare = setup({ gateway: null })
  assert.deepEqual(await bare.call("list_connected_tools"), { tools: [], revision: "none" })
  assert.equal((await bare.call("call_connected_tool", { name: "diagrams__draw", arguments: {} })).error.code, "unsupported_op")
  assert.equal((await bare.call("call_connected_tool", { name: "Not A Tool", arguments: {} })).error.code, "bad_request")
})

test("model context a view left rides once on the next result from its terminal", async () => {
  const { windows, call } = setup()
  const shown = await call("show_window", { title: "Picker", html: "<p>x</p>" })
  const { commands } = windows.operations()
  await commands["app-windows.context"]({ envelope: { payload: { windowId: shown.window, text: "selection: blue" } }, context: { signal: new AbortController().signal } })
  // Another terminal's call does not collect it.
  const elsewhere = await call("list_windows", {}, context({ terminalSessionId: "session-2" }))
  assert.equal("modelContext" in elsewhere, false)
  const next = await call("list_windows")
  assert.equal(next.ok, true)
  assert.equal(next.modelContext, 'Context from the open window "Picker":\nselection: blue')
  assert.equal(next.result.windows.length, 1)
  const after = await call("list_windows")
  assert.equal("modelContext" in after, false)
})

test("the adapter's own listing of connected tools does not use up a view's context", async () => {
  const { windows, call } = setup()
  const shown = await call("show_window", { title: "Picker", html: "<p>x</p>" })
  const { commands } = windows.operations()
  await commands["app-windows.context"]({ envelope: { payload: { windowId: shown.window, text: "selection: blue" } }, context: { signal: new AbortController().signal } })
  // What the stdio adapter does on tools/list and whenever the list changes: its answer never reaches the model.
  for (let index = 0; index < 3; index += 1) {
    const listing = await call("list_connected_tools")
    assert.equal("modelContext" in listing, false)
    assert.ok(Array.isArray(listing.tools))
  }
  const next = await call("list_windows")
  assert.equal(next.modelContext, 'Context from the open window "Picker":\nselection: blue')
})

test("context from many windows is kept whole or left out, and never exceeds what the adapter accepts", async () => {
  const { windows, call } = setup()
  const { commands } = windows.operations()
  const text = "c".repeat(16 * 1024 - 8)
  const shown = []
  for (let index = 0; index < 8; index += 1) shown.push((await call("show_window", { title: `Window ${index}`, html: "<p>x</p>" })).window)
  for (const windowId of shown)
    await commands["app-windows.context"]({ envelope: { payload: { windowId, text } }, context: { signal: new AbortController().signal } })
  const next = await call("list_windows")
  assert.ok(Buffer.byteLength(next.modelContext, "utf8") <= 64 * 1024)
  // Whole notes only: three fit this result, and the rest wait for the next ones.
  const count = (context) => context.split('Context from the open window "').length - 1
  assert.equal(count(next.modelContext), 3)
  assert.equal(next.modelContext.includes(text), true)
  let delivered = 3
  for (let round = 0; round < 3; round += 1) {
    const later = await call("list_windows")
    if (later.modelContext === undefined) break
    assert.ok(Buffer.byteLength(later.modelContext, "utf8") <= 64 * 1024)
    delivered += count(later.modelContext)
  }
  // Every window's note reached the model, once.
  assert.equal(delivered, 8)
  assert.equal("modelContext" in (await call("list_windows")), false)
})
