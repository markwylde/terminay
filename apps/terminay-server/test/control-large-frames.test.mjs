import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import { connect } from "node:net"
import { join } from "node:path"
import { tmpdir } from "node:os"

const {
  CONTROL_MAX_FRAME_BYTES,
  CONTROL_MAX_LARGE_FRAME_BYTES,
  CONTROL_MAX_RESPONSE_BYTES,
  CONTROL_PROTOCOL_VERSION,
  ControlCapabilityStore,
  createControlEndpoint,
  encodeControlMessage,
} = await import("../dist/index.js")

async function withEndpoint(dispatch, run) {
  const directory = await mkdtemp(join(tmpdir(), "terminay-large-frames-"))
  const socketPath = join(directory, "control.sock")
  const capabilities = new ControlCapabilityStore({ tokenFactory: (() => { let n = 0; return () => `token-${++n}` })() })
  const endpoint = createControlEndpoint({ socketPath, capabilities, dispatch, onError: () => {} })
  await endpoint.start()
  try {
    await run({ socketPath, token: capabilities.mint("caller", "project-a").token })
  } finally {
    await endpoint.stop()
  }
}

function send(socketPath, value) {
  const socket = connect(socketPath)
  let buffer = ""
  return new Promise((resolve) => {
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      const newline = buffer.indexOf("\n")
      if (newline !== -1) { resolve(JSON.parse(buffer.slice(0, newline))); socket.destroy() }
    })
    socket.on("error", () => resolve("closed"))
    socket.on("close", () => resolve("closed"))
    socket.write(encodeControlMessage(value))
  })
}

const request = (token, op, params) => ({ id: "r1", token, version: CONTROL_PROTOCOL_VERSION, op, params })

test("show_window may carry a document larger than the ordinary frame bound", async () => {
  await withEndpoint((req) => ({ bytes: req.params.html.length }), async ({ socketPath, token }) => {
    const html = "x".repeat(CONTROL_MAX_FRAME_BYTES * 4)
    assert.deepEqual(await send(socketPath, request(token, "show_window", { title: "Big", html })), { id: "r1", ok: true, result: { bytes: html.length } })
  })
})

test("every other operation is still held to the ordinary frame bound", async () => {
  let dispatched = 0
  await withEndpoint(() => { dispatched += 1; return {} }, async ({ socketPath, token }) => {
    const text = "x".repeat(CONTROL_MAX_FRAME_BYTES + 1)
    assert.equal(await send(socketPath, request(token, "write_terminal", { terminal: "t", text })), "closed")
    assert.equal(await send(socketPath, request(token, "list_windows", { padding: text })), "closed")
  })
  assert.equal(dispatched, 0)
})

test("no operation may exceed the large frame bound", async () => {
  let dispatched = 0
  await withEndpoint(() => { dispatched += 1; return {} }, async ({ socketPath, token }) => {
    const html = "x".repeat(CONTROL_MAX_LARGE_FRAME_BYTES + 1)
    assert.equal(await send(socketPath, request(token, "show_window", { title: "Huge", html })), "closed")
  })
  assert.equal(dispatched, 0)
})

test("only connected-tool operations may return a large response", async () => {
  const big = "x".repeat(CONTROL_MAX_RESPONSE_BYTES * 2)
  await withEndpoint(() => ({ content: [{ type: "text", text: big }] }), async ({ socketPath, token }) => {
    const allowed = await send(socketPath, request(token, "call_connected_tool", { name: "a__b", arguments: {} }))
    assert.equal(allowed.ok, true)
    assert.equal(allowed.result.content[0].text.length, big.length)
    const refused = await send(socketPath, request(token, "list_windows", {}))
    assert.equal(refused.ok, false)
    assert.equal(refused.error.code, "limit_exceeded")
  })
})

test("model context a dispatcher attaches travels beside the result", async () => {
  await withEndpoint(() => ({ ok: true, result: { windows: [] }, modelContext: "selection: blue" }), async ({ socketPath, token }) => {
    assert.deepEqual(await send(socketPath, request(token, "list_windows", {})), { id: "r1", ok: true, result: { windows: [] }, modelContext: "selection: blue" })
  })
})
