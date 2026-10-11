import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import { connect } from "node:net"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  DEFAULT_MCP_PERMISSIONS,
  MCP_PERMISSION_GROUP_LABELS,
  McpApprovalService,
  NotificationManager,
  mcpPermissionsFromSettings,
} from "@terminay/server-core"

const {
  CONTROL_PERMISSION_GROUPS,
  CONTROL_PROTOCOL_VERSION,
  CONTROL_TOOL_OPERATIONS,
  ControlCapabilityStore,
  createControlEndpoint,
  createMcpPermissionGate,
  createNotificationControlAdapter,
  createTerminalControlAdapter,
  describeNotificationRequest,
  encodeControlMessage,
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

const tick = () => new Promise((resolve) => setImmediate(resolve))

function setup({ policies = {}, manager = {} } = {}) {
  // The settle timer never fires here: every record stays pending.
  const notifications = new NotificationManager({ setTimeout: () => 0, clearTimeout: () => {}, ...manager })
  const approvals = new McpApprovalService({ policies: { ...DEFAULT_MCP_PERMISSIONS, ...policies } })
  const dispatch = createTerminalControlAdapter({
    adapter: {},
    notifications: createNotificationControlAdapter({ notifications }),
    permissions: createMcpPermissionGate({
      approvals,
      describe: async ({ op, params }) => ({ agent: "Claude Code", terminalTitle: "Terminal 1", ...describeNotificationRequest(op, params) }),
    }),
  })
  const call = (op, params = {}, ctx = context()) => dispatch({ id: "r", version: 1, op, params }, ctx)
  return { notifications, approvals, dispatch, call }
}

test("the notification tools are their own permission group, Always Allow on a fresh server", () => {
  assert.equal(CONTROL_PERMISSION_GROUPS.send_notification, "notifications")
  assert.equal(CONTROL_PERMISSION_GROUPS.dismiss_notification, "notifications")
  assert.deepEqual(
    Object.entries(CONTROL_PERMISSION_GROUPS).filter(([, group]) => group === "notifications").map(([op]) => op),
    ["send_notification", "dismiss_notification"],
  )
  assert.equal(MCP_PERMISSION_GROUP_LABELS.notifications, "Notifications")
  assert.equal(DEFAULT_MCP_PERMISSIONS.notifications, "allow")
  assert.equal(mcpPermissionsFromSettings(undefined).notifications, "allow")
  assert.ok(CONTROL_TOOL_OPERATIONS.includes("send_notification"))
  assert.ok(CONTROL_TOOL_OPERATIONS.includes("dismiss_notification"))
})

test("send_notification adds one pending notification to the calling terminal and returns its handle", async () => {
  const { notifications, call } = setup()
  const result = await call("send_notification", { title: "Review ready", body: "Three files changed" })
  assert.equal(typeof result.notification, "string")
  assert.equal(typeof result.sent, "string")
  assert.equal(notifications.pendingCount, 1)
  const record = notifications.find(result.notification, { projectId: "project-a", sessionId: "session-1" })
  assert.equal(record.source, "message")
  assert.equal(record.title, "Review ready")
  assert.equal(record.body, "Three files changed")
  // The owner is the capability's, whatever the caller puts in its parameters.
  const claimed = await call("send_notification", { body: "Mine", terminal: "session-2", projectId: "project-b", sessionId: "session-2" })
  assert.ok(notifications.find(claimed.notification, { projectId: "project-a", sessionId: "session-1" }))
  assert.equal(notifications.find(claimed.notification, { projectId: "project-b", sessionId: "session-2" }), undefined)
})

test("send_notification with a handle replaces that notification in place", async () => {
  const { notifications, call } = setup()
  const first = await call("send_notification", { title: "Build", body: "Running" })
  const second = await call("send_notification", { body: "Finished", notification: first.notification })
  assert.equal(second.notification, first.notification)
  assert.equal(notifications.pendingCount, 1)
  const record = notifications.find(first.notification, { projectId: "project-a", sessionId: "session-1" })
  assert.equal(record.body, "Finished")
  assert.equal("title" in record, false)
  // Another terminal cannot replace it.
  const other = context({ terminalSessionId: "session-2" })
  assert.equal((await call("send_notification", { body: "Hijack", notification: first.notification }, other)).error.code, "not_found")
  assert.equal(notifications.find(first.notification, { projectId: "project-a", sessionId: "session-1" }).body, "Finished")
  assert.equal(notifications.pendingCount, 1)
})

test("an over-long body, an over-long title, and an empty body are bad requests that add nothing", async () => {
  const { notifications, call } = setup()
  const cases = [
    { body: "b".repeat(281) },
    { body: "ok", title: "t".repeat(81) },
    { body: "" },
    { body: "   " },
    {},
    { body: 7 },
    { body: "ok", title: 7 },
    { body: "ok", notification: "not a handle" },
  ]
  for (const params of cases) {
    const refused = await call("send_notification", params)
    assert.equal(refused.ok, false, JSON.stringify(params))
    assert.equal(refused.error.code, "bad_request", JSON.stringify(params))
    assert.ok(refused.error.message.length < 200)
  }
  assert.equal(notifications.pendingCount, 0)
  // The bounds themselves are accepted.
  assert.equal(typeof (await call("send_notification", { body: "b".repeat(280), title: "t".repeat(80) })).notification, "string")
  assert.equal(notifications.pendingCount, 1)
})

test("dismiss_notification removes the terminal's own notification and finds no other", async () => {
  const { notifications, call } = setup()
  const mine = await call("send_notification", { body: "Mine" })
  const other = context({ terminalSessionId: "session-2" })
  assert.equal((await call("dismiss_notification", { notification: mine.notification }, other)).error.code, "not_found")
  assert.equal(notifications.pendingCount, 1)
  // The terminal's own activity notification is not one it sent.
  const withIds = setup({ manager: { createId: (() => { let n = 0; return () => `n-${++n}` })() } })
  withIds.notifications.setActivity({ projectId: "project-a", sessionId: "session-1" }, "agent-finished")
  const activityId = "n-1"
  assert.ok(withIds.notifications.find(activityId, { projectId: "project-a", sessionId: "session-1" }))
  assert.equal((await withIds.call("dismiss_notification", { notification: activityId })).error.code, "not_found")
  assert.equal((await withIds.call("send_notification", { body: "Hijack", notification: activityId })).error.code, "not_found")
  assert.equal(withIds.notifications.find(activityId, { projectId: "project-a", sessionId: "session-1" }).kind, "agent-finished")
  assert.equal(withIds.notifications.pendingCount, 1)
  // Its own handle works, once.
  assert.deepEqual(await call("dismiss_notification", { notification: mine.notification }), { notification: mine.notification, dismissed: true })
  assert.equal(notifications.pendingCount, 0)
  assert.equal((await call("dismiss_notification", { notification: mine.notification })).error.code, "not_found")
  assert.equal((await call("dismiss_notification", { notification: "not a handle" })).error.code, "bad_request")
  assert.equal((await call("dismiss_notification", {})).error.code, "bad_request")
})

test("a ninth notification is refused and the eight remain", async () => {
  const { notifications, call } = setup()
  for (let index = 0; index < 8; index += 1)
    assert.equal(typeof (await call("send_notification", { body: `N${index}` })).notification, "string")
  const ninth = await call("send_notification", { body: "Ninth" })
  assert.equal(ninth.error.code, "limit_exceeded")
  assert.ok(ninth.error.message.length < 200)
  assert.equal(notifications.pendingCount, 8)
  // Another terminal has its own allowance.
  assert.equal(typeof (await call("send_notification", { body: "Other" }, context({ terminalSessionId: "session-2" }))).notification, "string")
})

test("sending too quickly fails with a bounded error and adds nothing more", async () => {
  const { notifications, call } = setup({ manager: { sendRateLimit: 2, now: () => 1_000 } })
  await call("send_notification", { body: "One" })
  await call("send_notification", { body: "Two" })
  const third = await call("send_notification", { body: "Three" })
  assert.equal(third.ok, false)
  assert.equal(third.error.code, "limit_exceeded")
  assert.ok(third.error.message.length < 200)
  assert.equal(notifications.pendingCount, 2)
})

test("a manager from another copy of server-core still reports its errors by name and code", async () => {
  const foreign = (code, message) => Object.assign(new Error(message), { name: "NotificationManagerError", code })
  const failing = (code) => createNotificationControlAdapter({ notifications: { send: () => { throw foreign(code, "refused") }, dismissSent: () => false } })
  const send = (code) => failing(code).sendNotification({ body: "x" }, context())
  assert.equal(send("invalid").error.code, "bad_request")
  assert.equal(send("not_found").error.code, "not_found")
  assert.equal(send("limit").error.code, "limit_exceeded")
  assert.equal(send("rate_limited").error.code, "limit_exceeded")
  // Anything else is not the manager's to explain and is not swallowed.
  const broken = createNotificationControlAdapter({ notifications: { send: () => { throw new Error("disk on fire") } } })
  assert.throws(() => broken.sendNotification({ body: "x" }, context()), /disk on fire/)
})

test("Ask Permission prompts with the title and body, and nothing is added until the user allows it", async () => {
  const { notifications, approvals, call } = setup({ policies: { notifications: "ask" } })
  const pending = call("send_notification", { title: "Review ready", body: "Three files changed" })
  await tick()
  const [approval] = approvals.list()
  assert.equal(approval.operation, "send_notification")
  assert.equal(approval.group, "notifications")
  assert.equal(approval.groupLabel, "Notifications")
  assert.equal(approval.summary, 'send a notification titled "Review ready": "Three files changed"')
  assert.deepEqual(approval.details, [{ label: "Title", value: "Review ready" }, { label: "Body", value: "Three files changed" }])
  assert.equal(notifications.pendingCount, 0)
  approvals.decide(approval.id, "once")
  const sent = await pending
  assert.equal(notifications.pendingCount, 1)
  assert.equal(notifications.find(sent.notification, { projectId: "project-a", sessionId: "session-1" }).body, "Three files changed")
  // Declining adds nothing; a body alone is stated without a title.
  const declined = call("send_notification", { body: "Only \u001b[31mbody\u001b[0m" })
  await tick()
  assert.equal(approvals.list()[0].summary, 'send a notification "Only body"')
  approvals.decide(approvals.list()[0].id, "decline")
  assert.equal((await declined).error.code, "permission_declined")
  assert.equal(notifications.pendingCount, 1)
})

test("Never Allow for Notifications refuses both tools without asking", async () => {
  const { notifications, approvals, call } = setup({ policies: { notifications: "deny" } })
  const refused = await call("send_notification", { body: "Hello" })
  assert.equal(refused.error.code, "permission_denied")
  assert.match(refused.error.message, /Notifications is set to Never Allow/)
  assert.equal((await call("dismiss_notification", { notification: "n-1" })).error.code, "permission_denied")
  assert.equal(approvals.list().length, 0)
  assert.equal(notifications.pendingCount, 0)
})

test("a host that binds no notification manager reports the tools unavailable", async () => {
  const dispatch = createTerminalControlAdapter({ adapter: {} })
  const result = await dispatch({ id: "r", version: 1, op: "send_notification", params: { body: "x" } }, context())
  assert.equal(result.error.code, "unsupported_op")
})

function send(socketPath, value) {
  const socket = connect(socketPath)
  let buffer = ""
  return new Promise((resolve) => {
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      const newline = buffer.indexOf("\n")
      if (newline === -1) return
      resolve(JSON.parse(buffer.slice(0, newline)))
      socket.destroy()
    })
    socket.on("close", () => resolve(undefined))
    socket.write(encodeControlMessage(value))
  })
}

test("any process holding the terminal's capability can send and dismiss over the socket, with no MCP client", async () => {
  const { notifications, dispatch } = setup()
  const directory = await mkdtemp(join(tmpdir(), "terminay-notification-tools-"))
  const socketPath = join(directory, "control.sock")
  const capabilities = new ControlCapabilityStore()
  const endpoint = createControlEndpoint({ socketPath, capabilities, dispatch, onError: () => {} })
  await endpoint.start()
  try {
    const mine = capabilities.mint("session-socket", "project-socket")
    const other = capabilities.mint("session-other", "project-socket")
    const frame = (token, op, params) => ({ id: "s1", token, version: CONTROL_PROTOCOL_VERSION, op, params })
    const sent = await send(socketPath, frame(mine.token, "send_notification", { title: "From a script", body: "No MCP client here" }))
    assert.equal(sent.ok, true)
    const handle = sent.result.notification
    const record = notifications.find(handle, { projectId: "project-socket", sessionId: "session-socket" })
    assert.equal(record.title, "From a script")
    assert.equal(record.body, "No MCP client here")
    assert.equal(notifications.pendingCount, 1)
    // Another terminal's capability cannot dismiss it; its own can.
    assert.equal((await send(socketPath, frame(other.token, "dismiss_notification", { notification: handle }))).error.code, "not_found")
    assert.equal(notifications.pendingCount, 1)
    assert.deepEqual((await send(socketPath, frame(mine.token, "dismiss_notification", { notification: handle }))).result, { notification: handle, dismissed: true })
    assert.equal(notifications.pendingCount, 0)
    // Without a capability nothing is added.
    assert.equal((await send(socketPath, frame("not-a-token", "send_notification", { body: "x" }))).error.code, "invalid_token")
    assert.equal(notifications.pendingCount, 0)
  } finally {
    await endpoint.stop()
  }
})
