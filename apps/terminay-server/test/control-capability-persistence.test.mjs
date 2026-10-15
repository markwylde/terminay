import test from "node:test"
import assert from "node:assert/strict"

const { ControlCapabilityStore } = await import("../dist/index.js")

/**
 * A terminal that outlives its server process still carries the control token
 * it was started with. These tests are the contract that lets the next server
 * honour that token without ever having stored it.
 */

function store(options = {}) {
  let n = 0
  let now = 1_000
  const capabilities = new ControlCapabilityStore({
    tokenFactory: () => `token-${++n}`,
    now: () => now,
    ...options,
  })
  return { capabilities, advance: (ms) => { now += ms } }
}

test("a saved capability authorizes the same token under a new server process", () => {
  const first = store()
  const lease = first.capabilities.mint("s1", "p1", "write")
  const saved = JSON.parse(JSON.stringify(first.capabilities.snapshot()))

  const second = store()
  assert.equal(second.capabilities.resolve(lease.token), null)
  assert.equal(second.capabilities.restore(saved, new Set(["s1"])), 1)
  assert.deepEqual(second.capabilities.resolve(lease.token), { terminalSessionId: "s1", projectId: "p1", scope: "write" })
  assert.equal(second.capabilities.authorize(lease.token, "write").terminalSessionId, "s1")
})

test("a snapshot carries digests and never a token", () => {
  const { capabilities } = store()
  const lease = capabilities.mint("s1", "p1", "write")
  const text = JSON.stringify(capabilities.snapshot())
  assert.equal(text.includes(lease.token), false)
  const [entry] = capabilities.snapshot()
  assert.match(entry.digest, /^[0-9a-f]{64}$/)
  assert.deepEqual(Object.keys(entry).sort(), ["digest", "issuedAt", "projectId", "reach", "scope", "terminalSessionId"])
})

test("a capability is restored only for a terminal that is still running", () => {
  const first = store()
  const kept = first.capabilities.mint("alive", "p1", "write")
  const dropped = first.capabilities.mint("ended", "p1", "write")
  const second = store()
  assert.equal(second.capabilities.restore(first.capabilities.snapshot(), new Set(["alive"])), 1)
  assert.notEqual(second.capabilities.resolve(kept.token), null)
  assert.equal(second.capabilities.resolve(dropped.token), null)
})

const DAY_MS = 24 * 60 * 60 * 1000

test("a capability does not expire while its terminal runs", () => {
  const first = store()
  const lease = first.capabilities.mint("s1", "p1", "write")
  first.advance(30 * DAY_MS)
  assert.notEqual(first.capabilities.resolve(lease.token), null)

  const second = store({ now: () => 1_000 + 60 * DAY_MS })
  assert.equal(second.capabilities.restore(first.capabilities.snapshot(), new Set(["s1"])), 1)
  assert.notEqual(second.capabilities.resolve(lease.token), null)
})

test("an entry saved with an expiry is restored and the expiry ignored", () => {
  const first = store()
  const lease = first.capabilities.mint("s1", "p1", "write")
  const [entry] = first.capabilities.snapshot()
  const second = store({ now: () => 1_000 + 7 * DAY_MS })
  assert.equal(second.capabilities.restore([{ ...entry, expiresAt: 2_000 }], new Set(["s1"])), 1)
  assert.notEqual(second.capabilities.resolve(lease.token), null)
})

test("pruning revokes capabilities whose terminal is no longer running", () => {
  const { capabilities, advance } = store()
  const alive = capabilities.mint("alive", "p1", "write")
  const gone = capabilities.mint("gone", "p1", "write")
  const revoked = []
  capabilities.onRevoked((_digest, sessionId) => revoked.push(sessionId))
  advance(DAY_MS)
  assert.equal(capabilities.prune(new Set(["alive"])), 1)
  assert.notEqual(capabilities.resolve(alive.token), null)
  assert.equal(capabilities.resolve(gone.token), null)
  assert.deepEqual(revoked, ["gone"])
  assert.equal(capabilities.snapshot().length, 1)
})

test("pruning leaves a capability minted for a terminal not yet listed as running", () => {
  const { capabilities, advance } = store()
  const launching = capabilities.mint("launching", "p1", "write")
  advance(1_000)
  assert.equal(capabilities.prune(new Set()), 0)
  assert.notEqual(capabilities.resolve(launching.token), null)
  advance(60_000)
  assert.equal(capabilities.prune(new Set()), 1)
  assert.equal(capabilities.resolve(launching.token), null)
})

test("malformed, forged, and conflicting entries are discarded", () => {
  const first = store()
  first.capabilities.mint("s1", "p1", "write")
  const [good] = first.capabilities.snapshot()
  const running = new Set(["s1", "s2"])
  const bad = [
    null,
    "nope",
    { ...good, digest: "short" },
    { ...good, digest: good.digest.toUpperCase() },
    { ...good, scope: "root" },
    { ...good, reach: "everything" },
    // Workspace reach belongs to the automation space alone.
    { ...good, reach: "workspace" },
    { ...good, terminalSessionId: "../escape" },
    { ...good, issuedAt: "soon" },
  ]
  const second = store()
  assert.equal(second.capabilities.restore(bad, running), 0)
  assert.deepEqual(second.capabilities.snapshot(), [])

  // A session that already holds a capability under this process keeps it.
  const current = second.capabilities.mint("s1", "p1", "read")
  assert.equal(second.capabilities.restore([good], running), 0)
  assert.equal(second.capabilities.resolve(current.token).scope, "read")
})

test("a disabled store restores nothing", () => {
  const first = store()
  const lease = first.capabilities.mint("s1", "p1", "write")
  const second = store({ enabled: false })
  assert.equal(second.capabilities.restore(first.capabilities.snapshot(), new Set(["s1"])), 0)
  second.capabilities.setEnabled(true)
  assert.equal(second.capabilities.resolve(lease.token), null)
})

test("every mint, revocation, and restore is announced so the saved copy can follow", () => {
  const { capabilities } = store()
  let changes = 0
  const stop = capabilities.onChanged(() => { changes += 1 })
  const lease = capabilities.mint("s1", "p1", "write")
  assert.equal(changes, 1)
  capabilities.revoke(lease.token)
  assert.equal(changes, 2)
  capabilities.mint("s2", "p1", "write")
  capabilities.onTerminalExit("s2")
  assert.equal(changes, 4)
  assert.deepEqual(capabilities.snapshot(), [])
  stop()
  capabilities.mint("s3", "p1", "write")
  assert.equal(changes, 4)
})

test("a restored capability is revoked like any other when its terminal exits", () => {
  const first = store()
  const lease = first.capabilities.mint("s1", "p1", "write")
  const second = store()
  const revoked = []
  second.capabilities.onRevoked((digest, sessionId) => revoked.push([digest, sessionId]))
  second.capabilities.restore(first.capabilities.snapshot(), new Set(["s1"]))
  assert.equal(second.capabilities.onTerminalExit("s1"), 1)
  assert.equal(second.capabilities.resolve(lease.token), null)
  assert.deepEqual(revoked, [[first.capabilities.snapshot()[0].digest, "s1"]])
})
