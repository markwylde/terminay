import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import { connect } from "node:net"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { DEFAULT_MCP_PERMISSIONS, McpApprovalService } from "@terminay/server-core"

const {
  CONTROL_OPERATIONS,
  CONTROL_PERMISSION_GROUPS,
  CONTROL_PROTOCOL_VERSION,
  ControlCapabilityStore,
  createControlEndpoint,
  createMcpPermissionGate,
  createServerControlDispatcher,
  encodeControlMessage,
} = await import("../dist/index.js")

const described = {
  agent: "Claude Code",
  terminalTitle: "Terminal 1",
  summary: 'add the automation "Digest"',
  details: [{ label: "Runs", value: "mail-digest", code: true }],
}

function context(overrides = {}) {
  return {
    terminalSessionId: "caller",
    projectId: "project-a",
    scope: "write",
    connectionId: "connection-1",
    requestId: "request-1",
    signal: new AbortController().signal,
    ...overrides,
  }
}

/** Resolves once `count` approvals are waiting, re-checked as the service publishes. */
function approvalsReach(approvals, count) {
  return new Promise((resolve) => {
    const check = () => {
      if (approvals.list().length !== count) return
      stop()
      resolve()
    }
    const stop = approvals.subscribe(check)
    check()
  })
}

/**
 * Request deadlines that come due only as the test moves this clock: `advance`
 * fires every deadline that falls due within it, in order.
 */
function manualClock() {
  let now = 0
  let next = 0
  const timers = new Map()
  return {
    setTimeout(handler, ms) {
      next += 1
      timers.set(next, { at: now + ms, handler })
      return next
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    advance(ms) {
      const until = now + ms
      for (;;) {
        const [due] = [...timers].filter(([, timer]) => timer.at <= until).sort(([a, x], [b, y]) => x.at - y.at || a - b)
        if (due === undefined) break
        timers.delete(due[0])
        now = due[1].at
        due[1].handler()
      }
      now = until
    },
  }
}

test("no MCP operation starts a project, lists recent folders, or browses server folders", async () => {
  // ADR-0066: the root folder browser is reachable only with root-change
  // authority on a client connection, never through an MCP capability token.
  // The control endpoint routes nothing outside this fixed set.
  const { PROJECT_START_OPERATIONS } = await import("@terminay/protocol")
  const reserved = Object.values(PROJECT_START_OPERATIONS)
  for (const op of CONTROL_OPERATIONS) {
    assert.equal(reserved.includes(op), false, op)
    assert.doesNotMatch(op, /browse|root_folder|recent|start_project/, op)
  }
})

test("every operation but capability discovery has exactly one fixed permission group", () => {
  assert.deepEqual(Object.keys(CONTROL_PERMISSION_GROUPS).sort(), [...CONTROL_OPERATIONS].sort())
  assert.equal(CONTROL_PERMISSION_GROUPS.get_mcp_capabilities, undefined)
  const byGroup = {}
  for (const [op, group] of Object.entries(CONTROL_PERMISSION_GROUPS)) {
    if (group === undefined) continue
    byGroup[group] = [...(byGroup[group] ?? []), op]
  }
  assert.deepEqual(byGroup.terminalsRead.sort(), [
    "get_layout", "get_terminal_status", "list_terminals", "read_terminal", "search_terminal",
    "wait_for_attention", "wait_for_command", "wait_for_idle",
  ])
  assert.deepEqual(byGroup.terminalsManage.sort(), [
    "arrange_tabs", "cancel_macro", "close_tab", "close_terminal", "create_folder", "delete_folder",
    "focus_home", "focus_project", "focus_tab", "focus_terminal", "list_macros", "move_tab",
    "move_tab_to_folder", "move_terminal_to_project", "open_file", "open_terminal",
    "rename_folder", "rename_terminal", "reorder_folders", "resize_pane", "run_command", "run_macro",
    "select_folder", "split_terminal", "update_terminal", "write_terminal",
  ])
  assert.deepEqual(byGroup.automationsRead.sort(), ["get_automation", "list_automation_runs", "list_automations"])
  assert.deepEqual(byGroup.automationsManage.sort(), [
    "create_automation", "delete_automation", "dismiss_missed_runs", "prune_automation_runs",
    "remove_automation_run", "run_automation", "set_automation_enabled", "stop_automation_run",
    "update_automation",
  ])
  assert.deepEqual(byGroup.notifications.sort(), ["dismiss_notification", "list_notifications", "send_notification"])
  assert.deepEqual(byGroup.settingsRead.sort(), ["get_settings", "list_shell_profiles"])
  assert.deepEqual(byGroup.settingsChange.sort(), [
    "delete_shell_profile", "reorder_shell_profiles", "save_shell_profile",
    "set_default_shell_profile", "update_settings",
  ])
})

function gated(policies, handler = (params) => ({ ran: params })) {
  const approvals = new McpApprovalService({ policies: { ...DEFAULT_MCP_PERMISSIONS, ...policies } })
  const describeCalls = []
  const permissions = createMcpPermissionGate({
    approvals,
    describe: async (request) => {
      describeCalls.push(request.op)
      return request.params.invalid === true
        ? { ok: false, error: { code: "bad_request", message: "trigger.cron must be a cron expression" } }
        : described
    },
  })
  const calls = []
  const dispatch = createServerControlDispatcher({
    permissions,
    handlers: {
      getMcpCapabilities: () => ({ tools: [] }),
      runCommand: (params) => { calls.push(params); return handler(params) },
      createAutomation: (params) => { calls.push(params); return handler(params) },
      listAutomations: (params) => { calls.push(params); return handler(params) },
    },
  })
  return { approvals, dispatch, calls, describeCalls }
}

const op = (name, params = {}) => ({ id: `${name}-1`, version: CONTROL_PROTOCOL_VERSION, op: name, params })

test("Always Allow runs without a prompt and Never Allow refuses with no side effect", async () => {
  const { dispatch, calls, describeCalls, approvals } = gated({ automationsRead: "deny" })
  assert.deepEqual(await dispatch(op("run_command", { terminal: "t", command: "ls" }), context()), { ran: { terminal: "t", command: "ls" } })
  const denied = await dispatch(op("list_automations"), context())
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, "permission_denied")
  assert.match(denied.error.message, /Settings > AI > Terminay MCP/)
  assert.equal(calls.length, 1)
  assert.deepEqual(describeCalls, [])
  assert.equal(approvals.list().length, 0)
  // Capability discovery is never gated.
  assert.deepEqual(await dispatch(op("get_mcp_capabilities"), context()), { tools: [] })
})

test("an invalid request is refused before anyone is asked to approve it", async () => {
  const { dispatch, calls, approvals } = gated({})
  const refused = await dispatch(op("create_automation", { invalid: true }), context())
  assert.equal(refused.error.code, "bad_request")
  assert.equal(approvals.list().length, 0)
  assert.equal(calls.length, 0)
})

test("the approved request is exactly the one shown, whatever the caller does afterwards", async () => {
  const { dispatch, calls, approvals } = gated({})
  const params = { name: "Digest", action: { kind: "runCommand", command: "mail-digest" }, claimedApproval: true }
  const pending = dispatch(op("create_automation", params), context())
  await approvalsReach(approvals, 1)
  params.action.command = "rm -rf ~"
  const [approval] = approvals.list()
  assert.equal(approval.agent, "Claude Code")
  approvals.decide(approval.id, "once")
  await pending
  assert.equal(calls[0].action.command, "mail-digest")
  assert.equal(Object.isFrozen(calls[0].action), true)
})

test("decline and cancellation never run the operation, even when approved at the same moment", async () => {
  const { dispatch, calls, approvals } = gated({})
  const declined = dispatch(op("create_automation", {}), context())
  await approvalsReach(approvals, 1)
  approvals.decide(approvals.list()[0].id, "decline")
  assert.equal((await declined).error.code, "permission_declined")
  const controller = new AbortController()
  const cancelled = dispatch(op("create_automation", {}), context({ signal: controller.signal }))
  await approvalsReach(approvals, 1)
  const [approval] = approvals.list()
  controller.abort()
  approvals.decide(approval.id, "once")
  assert.equal((await cancelled).error.code, "cancelled")
  assert.equal(calls.length, 0)
})

async function withEndpoint(options, run) {
  const directory = await mkdtemp(join(tmpdir(), "terminay-mcp-permissions-"))
  const socketPath = join(directory, "control.sock")
  const capabilities = new ControlCapabilityStore({ tokenFactory: (() => { let n = 0; return () => `token-${++n}` })() })
  // No request deadline comes due unless a test moves this clock.
  const clock = options.timers ?? manualClock()
  const endpoint = createControlEndpoint({ socketPath, capabilities, timers: clock, ...options })
  await endpoint.start()
  try {
    await run({ socketPath, capabilities })
  } finally {
    await endpoint.stop()
  }
}

function send(socketPath, value) {
  const socket = connect(socketPath)
  let buffer = ""
  const response = new Promise((resolve) => {
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      const newline = buffer.indexOf("\n")
      if (newline !== -1) resolve(JSON.parse(buffer.slice(0, newline)))
    })
    socket.on("close", () => resolve(undefined))
  })
  socket.write(encodeControlMessage(value))
  return { response, socket }
}

test("a request waiting on approval outlives the request deadline, and its handler gets a fresh one", async () => {
  let handlerStarted
  const handling = new Promise((resolve) => { handlerStarted = resolve })
  let finishHandler
  const handled = new Promise((resolve) => { finishHandler = resolve })
  const { dispatch, approvals } = gated({}, async () => {
    handlerStarted()
    await handled
    return { ok: true, result: "created" }
  })
  const clock = manualClock()
  await withEndpoint({ dispatch, requestTimeoutMs: 50, timers: clock }, async ({ socketPath, capabilities }) => {
    const lease = capabilities.mint("caller", "project-a")
    const { response, socket } = send(socketPath, { id: "c1", token: lease.token, version: CONTROL_PROTOCOL_VERSION, op: "create_automation", params: {} })
    await approvalsReach(approvals, 1)
    // Three deadlines' worth of waiting on the person: none comes due.
    clock.advance(150)
    assert.equal(approvals.list().length, 1)
    approvals.decide(approvals.list()[0].id, "once")
    await handling
    // The handler's own deadline starts when it does, not when the request did.
    clock.advance(20)
    finishHandler()
    assert.deepEqual(await response, { id: "c1", ok: true, result: "created" })
    socket.destroy()
  })
})

test("closing the caller's connection withdraws its approval", async () => {
  const { dispatch, approvals, calls } = gated({})
  await withEndpoint({ dispatch }, async ({ socketPath, capabilities }) => {
    const lease = capabilities.mint("caller", "project-a")
    const { socket } = send(socketPath, { id: "c1", token: lease.token, version: CONTROL_PROTOCOL_VERSION, op: "create_automation", params: {} })
    await approvalsReach(approvals, 1)
    socket.destroy()
    await approvalsReach(approvals, 0)
    assert.equal(calls.length, 0)
  })
})

test("revoking the terminal's capability ends its approvals and session grants", async () => {
  const { dispatch, approvals } = gated({})
  await withEndpoint({ dispatch }, async ({ socketPath, capabilities }) => {
    capabilities.onRevoked((_digest, terminalSessionId) => approvals.revokeTerminal(terminalSessionId))
    const lease = capabilities.mint("caller", "project-a")
    const first = send(socketPath, { id: "c1", token: lease.token, version: CONTROL_PROTOCOL_VERSION, op: "create_automation", params: {} })
    await approvalsReach(approvals, 1)
    approvals.decide(approvals.list()[0].id, "session")
    assert.equal((await first.response).ok, true)
    first.socket.destroy()
    assert.equal(approvals.effectivePolicy("automationsManage", "caller"), "allow")
    const second = send(socketPath, { id: "c2", token: lease.token, version: CONTROL_PROTOCOL_VERSION, op: "create_automation", params: {} })
    assert.equal((await second.response).ok, true)
    second.socket.destroy()
    // The terminal exits: its grant goes with its capability.
    capabilities.onTerminalExit("caller")
    assert.equal(approvals.effectivePolicy("automationsManage", "caller"), "ask")
    const fresh = capabilities.mint("caller", "project-a")
    const third = send(socketPath, { id: "c3", token: fresh.token, version: CONTROL_PROTOCOL_VERSION, op: "create_automation", params: {} })
    await approvalsReach(approvals, 1)
    capabilities.onTerminalExit("caller")
    assert.equal((await third.response).error.code, "invalid_token")
    assert.equal(approvals.list().length, 0)
    third.socket.destroy()
  })
})
