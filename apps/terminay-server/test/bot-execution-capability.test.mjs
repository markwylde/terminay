import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import { connect } from "node:net"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { AUTOMATION_SPACE_PROJECT_ID, DEFAULT_MCP_PERMISSIONS, McpApprovalService } from "@terminay/server-core"

const {
  CONTROL_PROTOCOL_VERSION,
  ControlCapabilityStore,
  botCallerKey,
  createControlEndpoint,
  createMcpPermissionGate,
  createServerControlDispatcher,
  encodeControlMessage,
} = await import("../dist/index.js")

// A bot execution's Terminay MCP capability (ADR-0100).
const BOT = "abcdefabcdef"
const RUN = "0123456789abcdef01234567"
const OTHER_RUN = "76543210fedcba9876543210"

const tokens = () => { let n = 0; return () => `token-${++n}` }

test("a bot execution capability has workspace reach, no terminal, and is never saved", () => {
  const store = new ControlCapabilityStore({ tokenFactory: tokens() })
  const lease = store.mintBot(BOT, RUN)
  assert.equal(lease.terminalSessionId, botCallerKey(BOT, RUN))
  assert.equal(lease.reach, "workspace")
  const scope = store.resolve(lease.token)
  assert.equal(scope.reach, "workspace")
  assert.equal(scope.projectId, AUTOMATION_SPACE_PROJECT_ID)
  assert.deepEqual(scope.bot, { botId: BOT, executionId: RUN })
  assert.equal(scope.chat, undefined)
  assert.equal(store.snapshot().length, 0)
  // The bot key space is reserved: no terminal can claim it.
  assert.throws(() => store.mint(botCallerKey(BOT, RUN), "project-a"))
  assert.throws(() => store.mintBot("BAD", RUN))
  assert.throws(() => store.mintBot(BOT, "short"))
})

test("revoking a bot ends every execution's capability; one execution can be revoked alone", () => {
  const store = new ControlCapabilityStore({ tokenFactory: tokens() })
  const a = store.mintBot(BOT, RUN)
  const b = store.mintBot(BOT, OTHER_RUN)
  const other = store.mintBot("fedcbafedcba", RUN)
  assert.equal(store.revokeBot(BOT, RUN), 1)
  assert.equal(store.resolve(a.token), null)
  assert.notEqual(store.resolve(b.token), null)
  assert.equal(store.revokeBot(BOT), 1)
  assert.equal(store.resolve(b.token), null)
  assert.notEqual(store.resolve(other.token), null, "another bot is untouched")
  // Pruning terminals never touches a bot execution.
  const fresh = store.mintBot(BOT, RUN)
  assert.equal(store.prune(new Set()), 0)
  assert.notEqual(store.resolve(fresh.token), null)
})

test("disabling MCP revokes bot capabilities and refuses new ones", () => {
  const store = new ControlCapabilityStore({ tokenFactory: tokens() })
  const lease = store.mintBot(BOT, RUN)
  store.setEnabled(false)
  assert.equal(store.resolve(lease.token), null)
  assert.throws(() => store.mintBot(BOT, RUN), /disabled/)
  store.setEnabled(true)
  assert.equal(store.resolve(lease.token), null, "re-enabling restores nothing")
})

function botContext(overrides = {}) {
  return {
    terminalSessionId: botCallerKey(BOT, RUN),
    projectId: AUTOMATION_SPACE_PROJECT_ID,
    scope: "write",
    reach: "workspace",
    bot: { botId: BOT, executionId: RUN },
    connectionId: "connection-1",
    requestId: "request-1",
    signal: new AbortController().signal,
    ...overrides,
  }
}

function gated(policies) {
  const approvals = new McpApprovalService({ policies: { ...DEFAULT_MCP_PERMISSIONS, ...policies } })
  let authorizeCalls = 0
  const original = approvals.authorize.bind(approvals)
  approvals.authorize = (...args) => { authorizeCalls += 1; return original(...args) }
  const permissions = createMcpPermissionGate({
    approvals,
    describe: async () => { throw new Error("a bot is never described for a prompt") },
  })
  const calls = []
  const dispatch = createServerControlDispatcher({
    permissions,
    handlers: {
      getMcpCapabilities: () => ({ tools: [] }),
      runCommand: (params) => { calls.push(params); return { ran: params } },
      createAutomation: (params) => { calls.push(params); return { created: true } },
    },
  })
  return {
    approvals,
    dispatch,
    calls,
    setPolicies: (next) => approvals.setPolicies({ ...DEFAULT_MCP_PERMISSIONS, ...next }),
    authorizeCalls: () => authorizeCalls,
  }
}

const op = (name, params = {}) => ({ id: `${name}-1`, version: CONTROL_PROTOCOL_VERSION, op: name, params })

test("Ask Permission runs at once for a bot, with no approval, and Never Allow still refuses", async () => {
  const { dispatch, approvals, calls, authorizeCalls } = gated({ terminalsManage: "ask", automationsManage: "deny" })
  assert.deepEqual(
    await dispatch(op("run_command", { terminal: "api", command: "npm test" }), botContext()),
    { ran: { terminal: "api", command: "npm test" } },
  )
  const denied = await dispatch(op("create_automation", {}), botContext())
  assert.equal(denied.error.code, "permission_denied")
  assert.match(denied.error.message, /Never Allow/)
  assert.equal(calls.length, 1)
  assert.equal(approvals.list().length, 0)
  assert.equal(authorizeCalls(), 0, "the approval service is never asked")
})

test("a policy change applies to a bot's next call", async () => {
  const { dispatch, setPolicies } = gated({ terminalsManage: "ask" })
  assert.equal((await dispatch(op("run_command", { terminal: "api", command: "ls" }), botContext())).ran.command, "ls")
  setPolicies({ terminalsManage: "deny" })
  assert.equal(
    (await dispatch(op("run_command", { terminal: "api", command: "ls" }), botContext())).error.code,
    "permission_denied",
  )
})

test("tools that need a calling terminal are unsupported for a bot", async () => {
  const { dispatch } = gated({})
  const refused = await dispatch(op("show_window", { title: "x", html: "<p>x</p>" }), botContext())
  assert.equal(refused.error.code, "unsupported_op")
})

test("revoking a bot aborts its in-flight request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "terminay-bot-capability-"))
  const socketPath = join(directory, "control.sock")
  const capabilities = new ControlCapabilityStore({ tokenFactory: tokens() })
  let dispatched
  const active = new Promise((resolve) => { dispatched = resolve })
  let seen
  const endpoint = createControlEndpoint({
    socketPath,
    capabilities,
    dispatch: async (_request, context) => {
      seen = context
      dispatched()
      await new Promise((resolve) => context.signal.addEventListener("abort", resolve, { once: true }))
      return { reached: true }
    },
  })
  await endpoint.start()
  try {
    const lease = capabilities.mintBot(BOT, RUN)
    const socket = connect(socketPath)
    const response = new Promise((resolve) => {
      let buffer = ""
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8")
        const newline = buffer.indexOf("\n")
        if (newline !== -1) resolve(JSON.parse(buffer.slice(0, newline)))
      })
    })
    socket.write(encodeControlMessage({ id: "wait", token: lease.token, version: CONTROL_PROTOCOL_VERSION, op: "wait_for_command", params: {} }))
    await active
    assert.deepEqual(seen.bot, { botId: BOT, executionId: RUN })
    capabilities.revokeBot(BOT)
    const reply = await response
    assert.equal(reply.error.code, "invalid_token")
    socket.destroy()
  } finally {
    await endpoint.stop()
  }
})
