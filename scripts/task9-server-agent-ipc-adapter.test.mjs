import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

const { createServerAgentStatusIpcAdapter } = await importAdapter()
const { AgentStatusService, TerminalActivityService } = await import('@terminay/server-core')

const SERVER_ID = 'server-task9'

function identity(projectId, sessionId) {
  return { serverId: SERVER_ID, projectId, sessionId }
}

async function createFixture() {
  const activity = new TerminalActivityService({ serverId: SERVER_ID, now: () => 100 })
  const agents = new AgentStatusService({
    activity,
    now: () => 100,
  })
  await agents.start()
  const identities = new Map()
  const adapter = createServerAgentStatusIpcAdapter({
    agents,
    agentIdentity: (terminalSessionId) => identities.get(terminalSessionId),
  })

  async function createUnreadRoot(value) {
    identities.set(value.sessionId, value)
    activity.register(value)
    agents.register(value)
    await agents.ingestJournalRecord(value, 'codex', {
      type: 'session_meta', payload: { id: `codex-${value.sessionId}` },
    })
    await agents.ingestJournalRecord(value, 'codex', {
      type: 'event_msg', payload: { type: 'request_user_input' },
    })
    const entry = Object.values(agents.getSnapshot().entries)
      .find((candidate) => candidate.activationTerminalSessionId === value.sessionId)
    assert.ok(entry, `expected an agent entry for ${value.sessionId}`)
    assert.equal(entry.unread, true)
    return entry
  }

  return { agents, adapter, createUnreadRoot, identities }
}

test('server agent IPC adapter acknowledges only the scoped active entry and terminal', async () => {
  const fixture = await createFixture()
  try {
    const first = await fixture.createUnreadRoot(identity('project-a', 'terminal-a'))
    const second = await fixture.createUnreadRoot(identity('project-b', 'terminal-b'))

    assert.equal(fixture.adapter.markAcknowledged(first.entryId), true)
    assert.equal(fixture.agents.getSnapshot().entries[first.entryId].unread, false)
    assert.equal(fixture.agents.getSnapshot().entries[second.entryId].unread, true)
    assert.equal(fixture.adapter.markAcknowledged(first.entryId), false)

    assert.equal(fixture.adapter.markTerminalAcknowledged('terminal-a'), 0)
    assert.equal(fixture.adapter.markTerminalAcknowledged('terminal-b'), 1)
    assert.equal(fixture.agents.getSnapshot().entries[second.entryId].unread, false)
    assert.equal(fixture.adapter.markTerminalAcknowledged('terminal-b'), 0)
  } finally {
    await fixture.agents.stop()
  }
})

test('server agent IPC adapter rejects exited, unknown, and cross-terminal acknowledgements', async () => {
  const fixture = await createFixture()
  try {
    const firstIdentity = identity('project-a', 'terminal-a')
    const first = await fixture.createUnreadRoot(firstIdentity)
    fixture.agents.terminalExited(firstIdentity)

    const beforeExited = fixture.agents.getSnapshot()
    assert.equal(fixture.adapter.markAcknowledged(first.entryId), false)
    assert.equal(fixture.adapter.markTerminalAcknowledged('terminal-a'), 0)
    assert.equal(fixture.agents.getSnapshot(), beforeExited)

    const beforeUnknown = fixture.agents.getSnapshot()
    assert.equal(fixture.adapter.markAcknowledged('missing-entry'), false)
    assert.equal(fixture.adapter.markTerminalAcknowledged('missing-terminal'), 0)
    assert.equal(fixture.agents.getSnapshot(), beforeUnknown)

    const active = await fixture.createUnreadRoot(identity('project-b', 'terminal-b'))
    fixture.identities.set('terminal-b', identity('project-a', 'terminal-b'))
    assert.equal(fixture.adapter.markAcknowledged(active.entryId), false)
    assert.equal(fixture.agents.getSnapshot().entries[active.entryId].unread, true)
  } finally {
    await fixture.agents.stop()
  }
})

test('server agent IPC adapter never publishes stale or cross-project remapped session rows', async () => {
  const fixture = await createFixture()
  try {
    const staleIdentity = identity('project-a', 'terminal-stale')
    const stale = await fixture.createUnreadRoot(staleIdentity)
    fixture.agents.terminalExited(staleIdentity)

    const liveIdentity = identity('project-b', 'terminal-live')
    const live = await fixture.createUnreadRoot(liveIdentity)
    // Simulate a host map which no longer names the immutable project that
    // registered this terminal id. The store must not leak that row through
    // preload IPC merely because the session id still happens to match.
    fixture.identities.set(liveIdentity.sessionId, identity('project-a', liveIdentity.sessionId))

    const entries = fixture.adapter.getSnapshot().entries
    assert.equal(entries[stale.entryId], undefined)
    assert.equal(entries[live.entryId], undefined)

    const published = []
    const unsubscribe = fixture.adapter.subscribe((snapshot) => published.push(snapshot))
    await fixture.agents.ingestJournalRecord(liveIdentity, 'codex', {
      type: 'event_msg', payload: { type: 'task_complete' },
    })
    unsubscribe()
    assert.ok(published.length > 0)
    assert.equal(published.at(-1).entries[stale.entryId], undefined)
    assert.equal(published.at(-1).entries[live.entryId], undefined)
  } finally {
    await fixture.agents.stop()
  }
})

async function importAdapter() {
  const outputPath = join(await mkdtemp(join(tmpdir(), 'terminay-task9-ipc-adapter-')), 'adapter.mjs')
  await build({
    bundle: true,
    entryPoints: [new URL('../electron/agentStatus/serverAdapter.ts', import.meta.url).pathname],
    format: 'esm',
    outfile: outputPath,
    platform: 'node',
    target: 'node24',
  })
  return import(outputPath)
}
