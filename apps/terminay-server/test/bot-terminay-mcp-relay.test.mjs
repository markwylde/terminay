import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

const {
  BOT_TERMINAY_MCP_MAX_OUTSTANDING,
  ControlCapabilityStore,
  createBotTerminayMcpHost,
  createBotTerminayMcpRelay,
  createControlEndpoint,
} = await import("../dist/index.js")

// The host side of a bot execution's `terminay` relay (ADR-0100): one MCP
// session per adapter connection, over a real control endpoint.

const BOT = "abcdefabcdef"
const RUN = "0123456789abcdef01234567"

async function withEndpoint(dispatch, run) {
  const directory = await mkdtemp(join(tmpdir(), "terminay-bot-relay-"))
  const socketPath = join(directory, "control.sock")
  const capabilities = new ControlCapabilityStore({ tokenFactory: (() => { let n = 0; return () => `token-${++n}` })() })
  const endpoint = createControlEndpoint({ socketPath, capabilities, dispatch })
  await endpoint.start()
  try {
    await run({ socketPath, capabilities })
  } finally {
    await endpoint.stop()
  }
}

/** A relay connection as the container's adapter would drive it. */
function adapter(relay, connection) {
  const waiting = new Map()
  const reply = (message) => {
    const resolve = waiting.get(message.id)
    if (resolve) { waiting.delete(message.id); resolve(message) }
  }
  const request = (id, method, params = {}) =>
    new Promise((resolve) => {
      waiting.set(id, resolve)
      relay.handle(connection, { jsonrpc: "2.0", id, method, params }, reply)
    })
  return {
    request,
    initialize: () => request(0, "initialize", { protocolVersion: "2025-03-26", clientInfo: { name: "t", version: "1" }, capabilities: {} }),
  }
}

test("two adapter connections using the same request id each get their own reply", async () => {
  await withEndpoint(async (request) => ({ ok: true, result: { terminals: [], op: request.op } }), async ({ socketPath, capabilities }) => {
    const lease = capabilities.mintBot(BOT, RUN)
    const relay = createBotTerminayMcpRelay({ socketPath, token: lease.token })
    const a = adapter(relay, 1)
    const b = adapter(relay, 2)
    await a.initialize()
    await b.initialize()
    const [listA, listB] = await Promise.all([a.request(1, "tools/list"), b.request(1, "tools/list")])
    assert.ok(listA.result.tools.some((tool) => tool.name === "list_terminals"))
    assert.ok(listB.result.tools.some((tool) => tool.name === "create_project"))
    const called = await a.request(2, "tools/call", { name: "list_terminals", arguments: {} })
    assert.match(called.result.content[0].text, /list_terminals/)
    relay.close()
  })
})

test("a disconnect cancels only that connection's pending wait", async () => {
  const aborted = []
  let started
  const waiting = new Promise((resolve) => { started = resolve })
  await withEndpoint(async (request, context) => {
    if (request.op !== "wait_for_idle") return { ok: true, result: { terminals: [] } }
    started()
    await new Promise((resolve) => context.signal.addEventListener("abort", resolve, { once: true }))
    aborted.push(request.op)
    return { ok: true, result: null }
  }, async ({ socketPath, capabilities }) => {
    const lease = capabilities.mintBot(BOT, RUN)
    const relay = createBotTerminayMcpRelay({ socketPath, token: lease.token })
    const a = adapter(relay, 1)
    const b = adapter(relay, 2)
    await a.initialize()
    await b.initialize()
    void a.request(5, "tools/call", { name: "wait_for_idle", arguments: { terminal: "api", seconds: 5 } })
    await waiting
    relay.closeConnection(1)
    for (let i = 0; i < 50 && aborted.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 20))
    assert.deepEqual(aborted, ["wait_for_idle"])
    const still = await b.request(6, "tools/call", { name: "list_terminals", arguments: {} })
    assert.equal(still.result.isError, undefined)
    relay.close()
  })
})

test("outstanding requests per connection are bounded, and duplicate ids are refused", async () => {
  await withEndpoint(async () => ({ ok: true, result: { terminals: [] } }), async ({ socketPath, capabilities }) => {
    const lease = capabilities.mintBot(BOT, RUN)
    const relay = createBotTerminayMcpRelay({ socketPath, token: lease.token })
    // One reply path per connection, as the relay gives it.
    const replies = []
    const collect = (message) => replies.push(message)
    relay.handle(1, { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-03-26", clientInfo: { name: "t", version: "1" }, capabilities: {} } }, collect)
    for (let i = 0; i < 100 && !replies.some((r) => r.id === 0); i++) await new Promise((resolve) => setTimeout(resolve, 10))
    replies.length = 0
    // Sent in one go, before any reply can come back.
    for (let id = 1; id <= BOT_TERMINAY_MCP_MAX_OUTSTANDING; id++)
      relay.handle(1, { jsonrpc: "2.0", id, method: "tools/call", params: { name: "list_terminals", arguments: {} } }, collect)
    relay.handle(1, { jsonrpc: "2.0", id: 100, method: "tools/call", params: { name: "list_terminals", arguments: {} } }, collect)
    relay.handle(1, { jsonrpc: "2.0", id: 1, method: "ping" }, collect)
    assert.match(replies.find((r) => r.id === 100).error.message, /Too many outstanding/)
    assert.match(replies.find((r) => r.id === 1 && r.error).error.message, /Duplicate|Too many/)
    for (let i = 0; i < 100 && replies.filter((r) => r.result).length < BOT_TERMINAY_MCP_MAX_OUTSTANDING; i++)
      await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(replies.filter((r) => r.result).length, BOT_TERMINAY_MCP_MAX_OUTSTANDING)
    relay.close()
  })
})

test("the host seam mints only while allowed, revokes a mint a toggle-off overtook, and revokes on close", async () => {
  await withEndpoint(async () => ({ ok: true, result: {} }), async ({ socketPath, capabilities }) => {
    const host = createBotTerminayMcpHost({ capabilities, socketPath: () => socketPath })
    assert.equal(host.open(BOT, RUN, () => false), undefined)
    assert.equal(capabilities.revokeBot(BOT), 0, "nothing was minted")
    // Allowed when checked first, then taken away while minting.
    let checks = 0
    assert.equal(host.open(BOT, RUN, () => ++checks === 1), undefined)
    assert.equal(capabilities.revokeBot(BOT), 0, "the overtaken mint was revoked")
    const handler = host.open(BOT, RUN, () => true)
    assert.ok(handler)
    handler.close()
    assert.equal(capabilities.revokeBot(BOT), 0, "close revoked it")
    capabilities.setEnabled(false)
    assert.equal(host.open(BOT, RUN, () => true), undefined, "no access while MCP is off")
    assert.equal(createBotTerminayMcpHost({ capabilities, socketPath: () => undefined }).open(BOT, RUN, () => true), undefined)
  })
})

// The container adapter's start-up check, run against the real relay. The
// check is an MCP initialize, which this server validates like any client's.
test("the container adapter's start-up check passes against the real relay", async () => {
  const { createServer } = await import("node:net")
  const { spawn } = await import("node:child_process")
  const { once } = await import("node:events")
  const { randomBytes } = await import("node:crypto")
  const { rmSync } = await import("node:fs")
  const { fileURLToPath } = await import("node:url")
  const adapterPath = fileURLToPath(new URL("../../../docker/terminay-bot/bin/terminay-bot-mcp", import.meta.url))
  await withEndpoint(async () => ({ ok: true, result: {} }), async ({ socketPath, capabilities }) => {
    const lease = capabilities.mintBot(BOT, RUN)
    const relay = createBotTerminayMcpRelay({ socketPath, token: lease.token })
    const token = "c".repeat(64)
    const path = `/tmp/terminay-mcp-${randomBytes(12).toString("hex")}.sock`
    // Stands in for the in-container relay: one frame in, the relay's replies out.
    const server = createServer((socket) => {
      let buffer = ""
      socket.on("data", (bytes) => {
        buffer += bytes
        const at = buffer.indexOf("\n")
        if (at < 0) return
        const frame = JSON.parse(buffer.slice(0, at))
        assert.equal(frame.token, token)
        relay.handle(1, frame.message, (message) => socket.write(`${JSON.stringify(message)}\n`))
      })
    })
    await new Promise((resolve) => server.listen(path, resolve))
    try {
      const child = spawn("python3", [adapterPath, "--terminay-mcp", "--check-runtime"], {
        env: { PATH: process.env.PATH, TERMINAY_MCP_SOCKET: path, TERMINAY_MCP_TOKEN: token },
        stdio: ["ignore", "ignore", "pipe"],
      })
      let stderr = ""
      child.stderr.on("data", (bytes) => (stderr += bytes))
      const [code] = await once(child, "close")
      assert.equal(code, 0, stderr)
    } finally {
      relay.close()
      server.close()
      rmSync(path, { force: true })
    }
  })
})
