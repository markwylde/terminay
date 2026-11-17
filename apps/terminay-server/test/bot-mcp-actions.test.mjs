import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { connect } from "node:net"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { AUTOMATION_SPACE_PROJECT_ID, DEFAULT_MCP_PERMISSIONS, McpApprovalService } from "@terminay/server-core"

const {
  BOT_ACTION_OPERATIONS,
  CONTROL_PROTOCOL_VERSION,
  ControlCapabilityStore,
  botCallerKey,
  createControlEndpoint,
  createMcpPermissionGate,
  createServerControlDispatcher,
  encodeControlMessage,
  withBotActions,
} = await import("../dist/index.js")

// A bot's Terminay actions are recorded in its chat (ADR-0134).
const BOT = "abcdefabcdef"
const RUN = "0123456789abcdef01234567"

const op = (name, params = {}) => ({ id: `${name}-1`, version: CONTROL_PROTOCOL_VERSION, op: name, params })
const botContext = (overrides = {}) => ({
  terminalSessionId: botCallerKey(BOT, RUN),
  projectId: AUTOMATION_SPACE_PROJECT_ID,
  scope: "write",
  reach: "workspace",
  bot: { botId: BOT, executionId: RUN },
  connectionId: "connection-1",
  requestId: "request-1",
  signal: new AbortController().signal,
  ...overrides,
})

/** Fake host seams: terminal "api" is session s-1 in project-a. */
function harness(extra = {}) {
  const recorded = []
  const deferred = []
  const sessions = new Map([["s-1", "project-a"], ["s-new", "project-a"]])
  const deps = {
    epoch: () => "epoch-1",
    terminal: (_context, reference) =>
      reference === "api" || reference === "s-1"
        ? { sessionId: "s-1", title: "api" }
        : reference === "s-new" ? { sessionId: "s-new", title: "shell" } : undefined,
    sessionProject: (id) => sessions.get(id),
    project: (handle) => (handle === "handle-a" ? { projectId: "project-a", name: "api" } : undefined),
    record: async (botId, executionId, action, epoch) => { recorded.push({ botId, executionId, action, epoch }) },
    defer: (work) => deferred.push(work),
    onError: () => {},
    ...extra,
  }
  const flush = () => { while (deferred.length) deferred.shift()() }
  return { deps, recorded, deferred, flush, sessions }
}

test("reads, terminal callers and chat callers record nothing", async () => {
  const { deps, recorded, flush } = harness()
  const dispatch = withBotActions(async () => ({ ok: true }), deps)
  for (const name of ["list_terminals", "read_terminal", "get_workflow", "wait_for_idle", "get_mcp_capabilities", "call_connected_tool"])
    await dispatch(op(name, { terminal: "api" }), botContext())
  await dispatch(op("run_command", { terminal: "api", command: "ls" }), botContext({ bot: undefined }))
  await dispatch(op("run_command", { terminal: "api", command: "ls" }), botContext({ bot: undefined, chat: { chatId: "c" } }))
  flush()
  assert.equal(recorded.length, 0)
  assert.ok(!BOT_ACTION_OPERATIONS.has("read_terminal"))
  assert.ok(BOT_ACTION_OPERATIONS.has("create_project"))
})

test("the result returns before recording, unchanged, for bare and wrapped results", async () => {
  const { deps, recorded, deferred, flush } = harness()
  const bare = { ran: true }
  const wrapped = { ok: true, result: { terminal: "s-new" }, modelContext: "x" }
  assert.equal(await withBotActions(async () => bare, deps)(op("run_command", { terminal: "api", command: "npm test" }), botContext()), bare)
  assert.equal(await withBotActions(async () => wrapped, deps)(op("open_terminal"), botContext()), wrapped)
  assert.equal(recorded.length, 0, "nothing recorded before the response")
  assert.equal(deferred.length, 2)
  flush()
  assert.deepEqual(recorded[0], {
    botId: BOT,
    executionId: RUN,
    epoch: "epoch-1",
    action: {
      text: "Ran `npm test` in the terminal “api”",
      tool: "run_command",
      outcome: "done",
      target: { kind: "terminal", projectId: "project-a", sessionId: "s-1" },
    },
  })
  assert.deepEqual(recorded[1].action.target, { kind: "terminal", projectId: "project-a", sessionId: "s-new" })
  assert.equal(recorded[1].action.text, "Opened a terminal")
})

test("returned and thrown failures record a failed action with its reason", async () => {
  const { deps, recorded, flush } = harness()
  await withBotActions(async () => ({ ok: false, error: { code: "permission_denied", message: "Never Allow" } }), deps)(
    op("create_automation", { definition: { name: "Nightly" } }), botContext())
  await assert.rejects(
    withBotActions(async () => { throw Object.assign(new Error("boom"), { code: "internal" }) }, deps)(
      op("focus_project", { project: "handle-a" }), botContext()),
    /boom/,
  )
  flush()
  assert.equal(recorded[0].action.outcome, "failed")
  assert.equal(recorded[0].action.text, "Couldn't create the automation “Nightly”")
  assert.equal(recorded[0].action.reason, "permission_denied: Never Allow")
  assert.equal(recorded[0].action.target, undefined)
  assert.equal(recorded[1].action.reason, "internal: boom")
  assert.deepEqual(recorded[1].action.target, { kind: "project", projectId: "project-a" })
  assert.equal(recorded[1].action.text, "Couldn't switch to the project “api”")
})

test("targets: created project by handle, moved terminal in its new project, unknown handles none", async () => {
  const { deps, recorded, flush, sessions } = harness()
  await withBotActions(async () => ({ project: "handle-a", name: "api" }), deps)(op("create_project", { name: "api", root: "~" }), botContext())
  await withBotActions(async () => { sessions.set("s-1", "project-b"); return { terminal: "s-1" } }, deps)(
    op("move_terminal_to_project", { terminal: "api", project: "handle-b" }), botContext())
  await withBotActions(async () => ({ project: "handle-unknown" }), deps)(op("create_project", { name: "x" }), botContext())
  await withBotActions(async () => ({ closed: true }), deps)(op("close_terminal", { terminal: "api" }), botContext())
  await withBotActions(async () => ({ automation: { id: "auto-1" } }), deps)(op("create_automation", {}), botContext())
  await withBotActions(async () => ({ template: { id: "tpl-1" } }), deps)(op("create_workflow_template", { name: "Ship" }), botContext())
  await withBotActions(async () => ({}), deps)(op("create_workflow", { terminal: "api" }), botContext())
  await withBotActions(async () => ({}), deps)(op("update_settings", { settings: { theme: "dark" } }), botContext())
  flush()
  const targets = recorded.map((r) => r.action.target)
  assert.deepEqual(targets[0], { kind: "project", projectId: "project-a" })
  assert.deepEqual(targets[1], { kind: "terminal", projectId: "project-b", sessionId: "s-1" })
  assert.equal(targets[2], undefined)
  assert.equal(targets[3], undefined, "a closed terminal has no link")
  assert.deepEqual(targets[4], { kind: "automation", automationId: "auto-1" })
  assert.deepEqual(targets[5], { kind: "workflowTemplate", templateId: "tpl-1" })
  assert.deepEqual(targets[6], { kind: "workflow", projectId: "project-b", sessionId: "s-1" })
  assert.deepEqual(targets[7], { kind: "settings" })
  assert.equal(recorded[0].action.text, "Created the project “api”")
  assert.equal(recorded[7].action.text, "Changed the setting theme")
})

test("a recorder that throws leaves the tool result unchanged", async () => {
  const errors = []
  const { deps, flush } = harness({
    record: async () => { throw new Error("disk full") },
    epoch: () => { throw new Error("no log") },
    onError: (e) => errors.push(e),
  })
  const result = await withBotActions(async () => ({ ran: true }), deps)(op("run_command", { terminal: "api", command: "ls" }), botContext())
  assert.deepEqual(result, { ran: true })
  flush()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(errors.length, 2)
})

test("through the control endpoint: a bot's call records, a revoked token does not", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "bot-actions-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const socketPath = join(directory, "control.sock")
  const capabilities = new ControlCapabilityStore()
  const approvals = new McpApprovalService({ policies: { ...DEFAULT_MCP_PERMISSIONS } })
  const recorded = []
  const done = []
  const dispatch = withBotActions(
    createServerControlDispatcher({
      permissions: createMcpPermissionGate({ approvals, describe: async () => { throw new Error("no prompt") } }),
      handlers: {
        openTerminal: () => ({ terminal: "s-new" }),
        listTerminals: () => ({ terminals: [] }),
      },
    }),
    {
      ...harness().deps,
      defer: (work) => setImmediate(work),
      record: async (botId, executionId, action) => { recorded.push({ botId, executionId, action }); done.forEach((f) => f()) },
    },
  )
  const endpoint = createControlEndpoint({ socketPath, capabilities, dispatch })
  await endpoint.start()
  t.after(() => endpoint.stop())
  const call = (token, name, params = {}) => new Promise((resolve, reject) => {
    const socket = connect(socketPath)
    let buffer = ""
    socket.on("error", reject)
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      const newline = buffer.indexOf("\n")
      if (newline !== -1) { socket.destroy(); resolve(JSON.parse(buffer.slice(0, newline))) }
    })
    socket.write(encodeControlMessage({ id: name, token, version: CONTROL_PROTOCOL_VERSION, op: name, params }))
  })
  const lease = capabilities.mintBot(BOT, RUN)
  const recordedOne = new Promise((resolve) => done.push(resolve))
  const opened = await call(lease.token, "open_terminal")
  assert.equal(opened.ok, true)
  await recordedOne
  const listed = await call(lease.token, "list_terminals")
  assert.equal(listed.ok, true)
  capabilities.revokeBot(BOT)
  const refused = await call(lease.token, "open_terminal")
  assert.equal(refused.error.code, "invalid_token")
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(recorded.length, 1)
  assert.equal(recorded[0].botId, BOT)
  assert.equal(recorded[0].action.tool, "open_terminal")
  assert.deepEqual(recorded[0].action.target, { kind: "terminal", projectId: "project-a", sessionId: "s-new" })
})
