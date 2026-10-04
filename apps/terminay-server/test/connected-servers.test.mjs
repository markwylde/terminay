import assert from "node:assert/strict"
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const { ConnectedServerGateway } = await import("../dist/index.js")

const FIXTURE = fileURLToPath(new URL("./fixtures/upstream-apps-server.mjs", import.meta.url))
const signal = () => new AbortController().signal

async function setup({ entries, env = {}, now } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "terminay-gateway-")))
  const projects = { "project-a": join(root), "project-b": await realpath(await mkdtemp(join(tmpdir(), "terminay-gateway-b-"))) }
  const started = join(root, "started.jsonl")
  const gateway = new ConnectedServerGateway({
    projectRoot: (projectId) => projects[projectId],
    baseEnvironment: () => ({
      ...process.env,
      TERMINAY_CONTROL_SOCKET: "/tmp/terminay-control.sock",
      TERMINAY_CONTROL_TOKEN: "capability-token",
    }),
    connectTimeoutMs: 10_000,
    ...(now === undefined ? {} : { now }),
  })
  const entry = (overrides = {}) => ({
    name: "diagrams",
    enabled: true,
    transport: "stdio",
    command: process.execPath,
    args: [FIXTURE],
    env: { FIXTURE_STARTED_FILE: started, FIXTURE_SECRET: "s3cret", ...env },
    ...overrides,
  })
  gateway.setEntries(entries ? entries(entry) : [entry()])
  const starts = async () => {
    try {
      return (await readFile(started, "utf8")).split("}{").map((part, index, all) => JSON.parse((index > 0 ? "{" : "") + part + (index < all.length - 1 ? "}" : "")))
    } catch {
      return []
    }
  }
  return { gateway, projects, entry, starts }
}

test("nothing is started until a terminal first needs an entry's tools", async () => {
  const { gateway, starts } = await setup()
  try {
    assert.deepEqual(gateway.status(), [{ name: "diagrams", state: "idle", tools: 0 }])
    assert.deepEqual(await starts(), [])
  } finally {
    gateway.closeAll()
  }
})

test("a local server starts once per project, in the project root, without Terminay's control variables", async () => {
  const { gateway, projects, starts } = await setup()
  try {
    const tools = await gateway.listTools("project-a", signal())
    // Model-visible tools only, under the entry's prefix; the app-only tool is hidden.
    assert.deepEqual(tools.map((tool) => tool.name), ["diagrams__draw", "diagrams__plain", "diagrams__capabilities", "diagrams__huge"])
    assert.equal(tools[0].description, "Draw a shape and show it.")
    assert.deepEqual(tools[0].inputSchema, { type: "object", properties: { shape: { type: "string" } } })
    await gateway.listTools("project-a", signal())
    const first = await starts()
    assert.equal(first.length, 1)
    assert.equal(first[0].cwd, projects["project-a"])
    assert.equal(first[0].hasControlSocket, false)
    assert.equal(first[0].hasControlToken, false)
    // The entry's own environment is delivered.
    assert.equal(first[0].secret, "s3cret")
    await gateway.listTools("project-b", signal())
    const second = await starts()
    assert.equal(second.length, 2)
    assert.equal(second[1].cwd, projects["project-b"])
    assert.deepEqual(gateway.status(), [{ name: "diagrams", state: "connected", tools: 4 }])
  } finally {
    gateway.closeAll()
  }
})

test("Terminay advertises the MCP Apps extension to the server", async () => {
  const { gateway } = await setup()
  try {
    const result = await gateway.callTool("project-a", "diagrams__capabilities", {}, signal())
    const capabilities = JSON.parse(result.content[0].text)
    assert.deepEqual(capabilities.extensions, { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } })
  } finally {
    gateway.closeAll()
  }
})

test("a call is forwarded with its arguments and the server's result is returned", async () => {
  const { gateway } = await setup()
  try {
    assert.deepEqual(await gateway.callTool("project-a", "diagrams__draw", { shape: "circle" }, signal()), {
      content: [{ type: "text", text: "drew circle" }],
      structuredContent: { shapes: 1 },
    })
    await assert.rejects(gateway.callTool("project-a", "diagrams__missing", {}, signal()), /no connected tool/)
    // An app-only tool is not callable as a model tool.
    await assert.rejects(gateway.callTool("project-a", "diagrams__poll", {}, signal()), /no connected tool/)
    await assert.rejects(gateway.callTool("project-a", "elsewhere__draw", {}, signal()), /No connected server/)
  } finally {
    gateway.closeAll()
  }
})

test("a tool's declared UI is found and its resource read with its metadata", async () => {
  const { gateway } = await setup()
  try {
    assert.equal(await gateway.toolUi("project-a", "diagrams__plain", signal()), undefined)
    const ui = await gateway.toolUi("project-a", "diagrams__draw", signal())
    assert.equal(ui.entry, "diagrams")
    assert.equal(ui.tool, "draw")
    assert.equal(ui.resourceUri, "ui://diagrams/draw")
    assert.equal(ui.title, "Draw a diagram")
    const resource = await gateway.readUiResource("project-a", ui, signal())
    assert.match(resource.html, /<pre id="out">/)
    assert.equal(resource.mimeType, "text/html;profile=mcp-app")
    assert.deepEqual(resource.csp, { connectDomains: ["https://api.example"] })
    assert.deepEqual(resource.permissions, { clipboardWrite: {} })
  } finally {
    gateway.closeAll()
  }
})

test("a view reaches only app-visible tools of its own server", async () => {
  const { gateway } = await setup({
    entries: (entry) => [entry(), entry({ name: "other" })],
  })
  try {
    const polled = await gateway.callFromView("project-a", "diagrams", "tools/call", { name: "poll", arguments: {} }, signal())
    assert.deepEqual(polled.structuredContent, { polled: true })
    // A model-only tool, a tool that does not exist, and a Terminay tool name are refused.
    for (const name of ["draw", "missing", "run_command", "other__poll"])
      await assert.rejects(gateway.callFromView("project-a", "diagrams", "tools/call", { name, arguments: {} }, signal()), /may not call/)
    await assert.rejects(gateway.callFromView("project-a", "nowhere", "tools/call", { name: "poll" }, signal()), /No connected server/)
    const read = await gateway.callFromView("project-a", "diagrams", "resources/read", { uri: "ui://diagrams/draw" }, signal())
    assert.equal(read.contents[0].uri, "ui://diagrams/draw")
    await assert.rejects(gateway.callFromView("project-a", "diagrams", "resources/read", { uri: 7 }, signal()), /invalid/)
  } finally {
    gateway.closeAll()
  }
})

test("a server that cannot start contributes no tools, reports why, and does not block the others", async () => {
  const { gateway } = await setup({
    entries: (entry) => [
      entry({ name: "broken", command: "/nonexistent/terminay-fixture-command", args: [] }),
      entry({ name: "exits", env: { FIXTURE_FAIL: "1" } }),
      entry(),
    ],
  })
  try {
    const tools = await gateway.listTools("project-a", signal())
    assert.ok(tools.length > 0)
    assert.ok(tools.every((tool) => tool.name.startsWith("diagrams__")))
    const status = Object.fromEntries(gateway.status().map((entry) => [entry.name, entry]))
    assert.equal(status.diagrams.state, "connected")
    assert.equal(status.broken.state, "not-connected")
    assert.equal(status.exits.state, "not-connected")
    assert.ok(status.broken.reason.length > 0 && status.broken.reason.length <= 300)
    await assert.rejects(gateway.callTool("project-a", "broken__draw", {}, signal()), /is not connected/)
  } finally {
    gateway.closeAll()
  }
})

test("disabling, changing, or removing an entry closes its connections and stops offering its tools", async () => {
  const { gateway, entry, starts } = await setup()
  try {
    assert.equal((await gateway.listTools("project-a", signal())).length, 4)
    const before = gateway.revision("project-a")
    gateway.setEntries([entry({ enabled: false })])
    assert.notEqual(gateway.revision("project-a"), before)
    assert.deepEqual(gateway.status(), [{ name: "diagrams", state: "disabled", tools: 0 }])
    assert.deepEqual(await gateway.listTools("project-a", signal()), [])
    await assert.rejects(gateway.callTool("project-a", "diagrams__draw", {}, signal()), /No connected server/)
    // Re-enabled with a changed definition, it is a new process.
    gateway.setEntries([entry({ env: { FIXTURE_STARTED_FILE: (await starts())[0] ? undefined : undefined } })].map((e) => ({ ...e, env: { ...entry().env, FIXTURE_SECRET: "changed" } })))
    await gateway.listTools("project-a", signal())
    const all = await starts()
    assert.equal(all.length, 2)
    assert.equal(all[1].secret, "changed")
    assert.notEqual(all[1].pid, all[0].pid)
    gateway.setEntries([])
    assert.deepEqual(gateway.status(), [])
    assert.deepEqual(await gateway.listTools("project-a", signal()), [])
  } finally {
    gateway.closeAll()
  }
})

test("an unchanged entry keeps its connection when the list is saved again", async () => {
  const { gateway, entry, starts } = await setup()
  try {
    await gateway.listTools("project-a", signal())
    gateway.setEntries([entry(), entry({ name: "second", enabled: false })])
    await gateway.listTools("project-a", signal())
    assert.equal((await starts()).length, 1)
  } finally {
    gateway.closeAll()
  }
})

test("listeners hear when the offered tools may have changed, and a lost connection is re-made on demand, not in a loop", async () => {
  let clock = 5_000_000
  const { gateway, starts } = await setup({ now: () => clock })
  try {
    let changes = 0
    const stop = gateway.onChanged(() => { changes += 1 })
    await gateway.listTools("project-a", signal())
    assert.ok(changes >= 1)
    const [{ pid }] = await starts()
    const seen = changes
    process.kill(pid)
    for (let attempt = 0; attempt < 100 && gateway.status()[0].state === "connected"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(gateway.status()[0].state, "not-connected")
    assert.ok(changes > seen)
    // No timer brought it back.
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.equal((await starts()).length, 1)
    // The change just announced makes every waiting adapter list again. A
    // server that exits as soon as it has connected must not be started by
    // each of those listings: that is a loop with no agent in it.
    const settled = changes
    for (let index = 0; index < 5; index += 1) assert.deepEqual(await gateway.listTools("project-a", signal()), [])
    assert.equal((await starts()).length, 1)
    assert.equal(changes, settled)
    // Asking for one of its tools by name starts it at once.
    await gateway.callTool("project-a", "diagrams__plain", {}, signal())
    assert.equal((await starts()).length, 2)
    assert.equal((await gateway.listTools("project-a", signal())).length, 4)
    // Lost again and left alone for a while, the next listing brings it back.
    process.kill((await starts())[1].pid)
    for (let attempt = 0; attempt < 100 && gateway.status()[0].state === "connected"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20))
    assert.deepEqual(await gateway.listTools("project-a", signal()), [])
    clock += 31_000
    assert.equal((await gateway.listTools("project-a", signal())).length, 4)
    assert.equal((await starts()).length, 3)
    stop()
  } finally {
    gateway.closeAll()
  }
})

test("closing a project stops only that project's local servers", async () => {
  const { gateway, starts } = await setup()
  try {
    await gateway.listTools("project-a", signal())
    await gateway.listTools("project-b", signal())
    gateway.closeProject("project-a")
    assert.equal(gateway.status()[0].state, "connected")
    await gateway.listTools("project-b", signal())
    assert.equal((await starts()).length, 2)
    await gateway.listTools("project-a", signal())
    assert.equal((await starts()).length, 3)
  } finally {
    gateway.closeAll()
  }
})

test("an entry with an invalid name is ignored", async () => {
  const { gateway, entry } = await setup()
  try {
    gateway.setEntries([entry({ name: "Not Valid" }), entry({ name: "ok-name" })])
    assert.deepEqual(gateway.status().map((status) => status.name), ["ok-name"])
  } finally {
    gateway.closeAll()
  }
})

// --- a server that fails, callers that give up, and saves during a connect ---

/** A command that records each time it is started and then exits without speaking MCP. */
async function failingCommand() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "terminay-gateway-fail-")))
  const script = join(directory, "fail.mjs")
  const log = join(directory, "starts.log")
  await writeFile(script, `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(log)}, "x"); process.exit(1);`)
  const starts = async () => (await readFile(log, "utf8").catch(() => "")).length
  return { script, starts }
}

test("a server that keeps failing is not restarted by every listing, and does not announce a change each time", async () => {
  const failing = await failingCommand()
  let clock = 1_000_000
  const { gateway } = await setup({
    now: () => clock,
    entries: (entry) => [entry(), entry({ name: "broken", args: [failing.script], env: {} })],
  })
  try {
    let changes = 0
    gateway.onChanged(() => { changes += 1 })
    const names = async () => (await gateway.listTools("project-a", signal())).map((tool) => tool.name)
    assert.ok((await names()).every((name) => name.startsWith("diagrams__")))
    const revision = gateway.revision("project-a")
    const settled = changes
    assert.equal(await failing.starts(), 1)
    // An agent that lists again, and again, finds the same list and starts nothing.
    for (let index = 0; index < 5; index += 1) await names()
    assert.equal(gateway.revision("project-a"), revision)
    assert.equal(changes, settled)
    assert.equal(await failing.starts(), 1)
    assert.equal(gateway.status().find((entry) => entry.name === "broken").state, "not-connected")

    // Left alone for a while, it is tried again by the next listing. Failing the
    // same way is still not a change.
    clock += 31_000
    await names()
    assert.equal(await failing.starts(), 2)
    assert.equal(gateway.revision("project-a"), revision)

    // Asking for one of its tools by name tries at once, and says why it failed.
    await assert.rejects(gateway.callTool("project-a", "broken__anything", {}, signal()), /broken is not connected/)
    assert.equal(await failing.starts(), 3)

    // Saving the entry clears the wait.
    gateway.setEntries([{ name: "broken", enabled: true, transport: "stdio", command: process.execPath, args: [failing.script, "changed"], env: {} }])
    await names()
    assert.equal(await failing.starts(), 4)
  } finally {
    gateway.closeAll()
  }
})

test("one caller giving up does not fail a connection another caller is waiting for", async () => {
  const { gateway } = await setup()
  try {
    const impatient = new AbortController()
    const first = gateway.listTools("project-a", impatient.signal)
    const second = gateway.listTools("project-a", signal())
    impatient.abort(new Error("gave up"))
    await assert.rejects(first, /gave up/)
    assert.ok((await second).some((tool) => tool.name === "diagrams__draw"))
    // The server is connected, and the abandoned wait is not recorded as its failure.
    assert.equal(gateway.status()[0].state, "connected")
    // A caller that has already given up starts nothing.
    const { gateway: untouched, starts } = await setup()
    const gone = new AbortController()
    gone.abort(new Error("never asked"))
    await assert.rejects(untouched.listTools("project-a", gone.signal))
    untouched.closeAll()
    void starts
  } finally {
    gateway.closeAll()
  }
})

test("saving the list while a server is connecting does not fail an entry that did not change", async () => {
  const { gateway, entry } = await setup()
  try {
    const listing = gateway.listTools("project-a", signal())
    // The same entry saved again, as any save in Settings sends every entry.
    gateway.setEntries([entry(), entry({ name: "second" })])
    assert.ok((await listing).some((tool) => tool.name === "diagrams__draw"))
    assert.equal(gateway.status()[0].state, "connected")
  } finally {
    gateway.closeAll()
  }
})
