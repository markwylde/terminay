import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import { connect } from "node:net"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ServerSettingsRepository } from "@terminay/server-core"

const {
  CONTROL_PROTOCOL_VERSION,
  ControlCapabilityStore,
  ControlEndpointError,
  bindControlSetting,
  createControlOperationDispatcher,
  createControlEndpoint,
  encodeControlMessage,
} = await import("../dist/index.js")

async function withEndpoint(options, run) {
  const directory = await mkdtemp(join(tmpdir(), "terminay-headless-control-"))
  const socketPath = join(directory, "control.sock")
  const capabilities = options.capabilities ?? new ControlCapabilityStore({ tokenFactory: (() => { let n = 0; return () => `token-${++n}` })() })
  const endpoint = createControlEndpoint({ socketPath, capabilities, dispatch: async () => ({ ok: true }), ...options })
  await endpoint.start()
  try {
    await run({ endpoint, socketPath, capabilities })
  } finally {
    await endpoint.stop()
  }
}

test("server operation dispatch is explicit and normalizes handler outcomes", async () => {
  const dispatch = createControlOperationDispatcher({
    read_terminal: (request, context) => {
      assert.equal(request.op, "read_terminal")
      assert.equal(context.projectId, "project-a")
      assert.equal("token" in request, false)
      return { output: "bounded" }
    },
    rename_terminal: () => {
      throw new ControlEndpointError("terminal_not_found", "terminal is no longer live", ["candidate"])
    },
  })
  const context = {
    terminalSessionId: "caller",
    projectId: "project-a",
    scope: "write",
    connectionId: "connection-1",
    requestId: "read-1",
    signal: new AbortController().signal,
  }
  assert.deepEqual(await dispatch({ id: "read-1", version: CONTROL_PROTOCOL_VERSION, op: "read_terminal", params: {} }, context), { output: "bounded" })
  assert.deepEqual(await dispatch({ id: "missing-1", version: CONTROL_PROTOCOL_VERSION, op: "list_terminals", params: {} }, context), {
    ok: false,
    error: { code: "unsupported_op", message: "The control operation is not available: list_terminals." },
  })
  assert.deepEqual(await dispatch({ id: "rename-1", version: CONTROL_PROTOCOL_VERSION, op: "rename_terminal", params: {} }, context), {
    ok: false,
    error: { code: "terminal_not_found", message: "terminal is no longer live", candidates: ["candidate"] },
  })
  const unexpected = createControlOperationDispatcher({ read_terminal: () => { throw new Error("private detail") } })
  assert.deepEqual(await unexpected({ id: "read-2", version: CONTROL_PROTOCOL_VERSION, op: "read_terminal", params: {} }, context), {
    ok: false,
    error: { code: "internal", message: "The control operation failed." },
  })
  assert.throws(() => createControlOperationDispatcher({ not_a_control_operation: () => ({}) }), /unsupported control operation handler/)
  await withEndpoint({ dispatch }, async ({ socketPath, capabilities }) => {
    const lease = capabilities.mint("caller", "project-a")
    const response = await request(socketPath, {
      id: "wire-rename",
      token: lease.token,
      version: CONTROL_PROTOCOL_VERSION,
      op: "rename_terminal",
      params: {},
    })
    assert.deepEqual(response, {
      id: "wire-rename",
      ok: false,
      error: { code: "terminal_not_found", message: "terminal is no longer live", candidates: ["candidate"] },
    })
  })
})

test("headless endpoint resolves an implicit project scope without renderer or PID forwarding", async () => {
  await withEndpoint({}, async ({ capabilities }) => {
    const lease = capabilities.mint("caller", "project-a")
    const seen = []
    // A second endpoint is not needed; this test uses the endpoint's dispatcher
    // through a fresh endpoint to keep the assertion focused on the wire path.
    const directory = await mkdtemp(join(tmpdir(), "terminay-headless-dispatch-"))
    const path = join(directory, "control.sock")
    const endpoint = createControlEndpoint({
      socketPath: path,
      capabilities,
      dispatch: (request, context) => {
        seen.push({ request, context })
        return { value: "server-owned" }
      },
    })
    await endpoint.start()
    try {
      const response = await request(path, {
        id: "one",
        token: lease.token,
        version: CONTROL_PROTOCOL_VERSION,
        op: "list_terminals",
        params: {},
      })
      assert.deepEqual(response, { id: "one", ok: true, result: { value: "server-owned" } })
      assert.equal(seen[0].context.terminalSessionId, "caller")
      assert.equal(seen[0].context.projectId, "project-a")
      assert.equal("token" in seen[0].request, false)
      assert.equal("pid" in seen[0].request, false)
    } finally {
      await endpoint.stop()
    }
  })
})

test("invalid, copied, and forged credentials are rejected before dispatch", async () => {
  let dispatches = 0
  await withEndpoint({ dispatch: () => { dispatches += 1; return {} } }, async ({ socketPath, capabilities }) => {
    const lease = capabilities.mint("caller", "project-a")
    const invalid = await request(socketPath, {
      id: "invalid",
      token: "copied-or-stale",
      version: CONTROL_PROTOCOL_VERSION,
      op: "list_terminals",
      params: { projectId: "project-b", pid: process.pid },
    })
    assert.equal(invalid.ok, false)
    assert.equal(invalid.error.code, "invalid_token")
    const malformed = await request(socketPath, {
      id: "forged",
      token: lease.token,
      version: CONTROL_PROTOCOL_VERSION,
      op: "list_terminals",
      params: {},
      pid: process.pid,
    })
    assert.equal(malformed.ok, false)
    assert.equal(malformed.error.code, "bad_request")
    assert.equal(dispatches, 0)
    capabilities.revoke(lease.token)
    const stale = await request(socketPath, {
      id: "stale",
      token: lease.token,
      version: CONTROL_PROTOCOL_VERSION,
      op: "list_terminals",
      params: {},
    })
    assert.equal(stale.ok, false)
    assert.equal(stale.error.code, "invalid_token")
  })
})

test("moving a calling terminal replaces its project capability and exit revokes the replacement", () => {
  let next = 0
  const capabilities = new ControlCapabilityStore({ tokenFactory: () => `move-token-${++next}` })
  const original = capabilities.mint("caller", "project-a")
  const moved = capabilities.moveTerminal("caller", "project-b")

  assert.equal(capabilities.resolve(original.token), null)
  assert.deepEqual(capabilities.resolve(moved.token), {
    terminalSessionId: "caller",
    projectId: "project-b",
    scope: "write",
  })
  assert.equal(capabilities.onTerminalExit("caller"), 1)
  assert.equal(capabilities.resolve(moved.token), null)
})

test("server MCP setting disables and revokes capabilities immediately", async () => {
  let persisted
  const settings = new ServerSettingsRepository({
    async load() { return persisted },
    async commit(value) { persisted = value },
  })
  const capabilities = new ControlCapabilityStore({ tokenFactory: (() => { let n = 0; return () => `setting-token-${++n}` })() })
  const binding = await bindControlSetting(capabilities, settings)
  try {
    const lease = capabilities.mint("caller", "project-a")
    await settings.set("terminayMcp.enabled", false)
    assert.equal(capabilities.isEnabled(), false)
    assert.equal(capabilities.resolve(lease.token), null)
    assert.throws(() => capabilities.mint("caller", "project-a"), /disabled/)

    await settings.set("terminayMcp.enabled", true)
    assert.equal(capabilities.isEnabled(), true)
    const replacement = capabilities.mint("caller", "project-a")
    assert.notEqual(replacement.token, lease.token)
    assert.equal(capabilities.resolve(replacement.token)?.projectId, "project-a")
  } finally {
    binding.dispose()
  }
})

test("malformed and oversized partial frames never reach dispatch", async () => {
  let dispatches = 0
  await withEndpoint({ maxFrameBytes: 128, dispatch: () => { dispatches += 1; return {} } }, async ({ socketPath }) => {
    const malformed = await rawWrite(socketPath, "not json\n")
    assert.equal(malformed, true)
    const oversized = await rawWrite(socketPath, `${"x".repeat(129)}`)
    assert.equal(oversized, true)
    assert.equal(dispatches, 0)
  })
})

test("per-connection concurrency and deadlines are bounded", async () => {
  let release
  await withEndpoint({ maxInFlightPerConnection: 1, requestTimeoutMs: 30, dispatch: (_request, { signal }) => new Promise((resolve) => {
    release = () => resolve({ done: true })
    signal.addEventListener("abort", () => resolve({ done: false }), { once: true })
  }) }, async ({ socketPath, capabilities }) => {
    const lease = capabilities.mint("caller", "project-a")
    const socket = await openSocket(socketPath)
    const responses = collectResponses(socket)
    socket.write(encodeControlMessage({ id: "first", token: lease.token, version: CONTROL_PROTOCOL_VERSION, op: "list_terminals", params: {} }))
    socket.write(encodeControlMessage({ id: "second", token: lease.token, version: CONTROL_PROTOCOL_VERSION, op: "list_terminals", params: {} }))
    const limited = await responses.next()
    assert.equal(limited.id, "second")
    assert.equal(limited.error.code, "limit_exceeded")
    const timedOut = await responses.next()
    assert.equal(timedOut.id, "first")
    assert.equal(timedOut.error.code, "timeout")
    release?.()
    socket.destroy()
  })
})

test("revoking a capability aborts an active operation and rejects later requests", async () => {
  await withEndpoint({ dispatch: async (_request, { signal }) => {
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }))
    return { reached: true }
  } }, async ({ socketPath, capabilities }) => {
    const lease = capabilities.mint("caller", "project-a")
    const socket = await openSocket(socketPath)
    const responses = collectResponses(socket)
    socket.write(encodeControlMessage({ id: "active", token: lease.token, version: CONTROL_PROTOCOL_VERSION, op: "list_terminals", params: {} }))
    await new Promise((resolve) => setTimeout(resolve, 5))
    capabilities.revoke(lease.token)
    const response = await responses.next()
    assert.equal(response.id, "active")
    assert.equal(response.error.code, "invalid_token")
    socket.destroy()
  })
})

test("stopping the local server revokes capabilities held by its clients", async () => {
  const directory = await mkdtemp(join(tmpdir(), "terminay-headless-stop-"))
  const socketPath = join(directory, "control.sock")
  const capabilities = new ControlCapabilityStore({ tokenFactory: () => "shutdown-token" })
  const lease = capabilities.mint("caller", "project-a")
  const endpoint = createControlEndpoint({ socketPath, capabilities, dispatch: () => ({}) })
  await endpoint.start()
  await endpoint.stop()
  assert.equal(capabilities.resolve(lease.token), null)
})

async function request(socketPath, value) {
  const socket = await openSocket(socketPath)
  const responses = collectResponses(socket)
  try {
    socket.write(encodeControlMessage(value))
    return await responses.next()
  } finally {
    socket.destroy()
  }
}

async function rawWrite(socketPath, value) {
  const socket = await openSocket(socketPath)
  const closed = new Promise((resolve) => socket.once("close", () => resolve(true)))
  socket.write(value)
  return await closed
}

async function openSocket(socketPath) {
  const socket = connect(socketPath)
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve)
    socket.once("error", reject)
  })
  return socket
}

function collectResponses(socket) {
  let buffer = ""
  const queued = []
  const waiters = []
  socket.setEncoding("utf8")
  socket.on("data", (chunk) => {
    buffer += chunk
    let newline = buffer.indexOf("\n")
    while (newline !== -1) {
      const value = JSON.parse(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      const waiter = waiters.shift()
      if (waiter) waiter(value)
      else queued.push(value)
      newline = buffer.indexOf("\n")
    }
  })
  return { next: () => queued.length > 0 ? Promise.resolve(queued.shift()) : new Promise((resolve) => waiters.push(resolve)) }
}
