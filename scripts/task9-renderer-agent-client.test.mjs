import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const directory = await mkdtemp(join(process.cwd(), '.task9-renderer-agent-'))
await build({ absWorkingDir: process.cwd(), bundle: true, entryPoints: ['src/shared/rendererAgentConnection.ts'], format: 'esm', outdir: directory, platform: 'node', logLevel: 'silent' })
const { adaptServerAgentSnapshot, subscribeServerAgentSnapshots } = await import(pathToFileURL(join(directory, 'rendererAgentConnection.js')).href)
test.after(async () => { await rm(directory, { recursive: true, force: true }) })

function entry(overrides = {}) {
	return {
		entryId: 'term-a:session-a:agent-a', kind: 'root', provider: 'com.terminay.agent.codex/cli', agentId: 'agent-a', sessionId: 'session-a', activationTerminalSessionId: 'term-a', terminalSessionId: 'term-a', inProcess: false,
		state: 'waiting', stateStartedAt: 10, updatedAt: 11, lastEventKind: 'wait.started', lastEventSequence: 4, active: true, activeTools: [], unread: true,
		...overrides,
	}
}

test('adapts only a valid reduced server agent snapshot into the shared UI shape', () => {
	const snapshot = adaptServerAgentSnapshot({ revision: 7, cursor: '7', entries: { 'term-a:session-a:agent-a': entry() } })
	assert.equal(snapshot.revision, 7)
	assert.equal(snapshot.entries['term-a:session-a:agent-a'].kind, 'root')
	assert.deepEqual(snapshot.eventCursors, {})
	assert.throws(() => adaptServerAgentSnapshot({ revision: 8, cursor: '8', entries: { bad: entry({ terminalSessionId: null }) } }), /root agent shape/u)
})

test('connected agent source uses its server client and stops on unsubscribe', () => {
	const listeners = new Set()
	const client = {
		snapshot: { revision: 1, cursor: '1', entries: { 'term-a:session-a:agent-a': entry() } },
		onChange(listener) { listeners.add(listener); return () => listeners.delete(listener) },
	}
	const received = []
	const unsubscribe = subscribeServerAgentSnapshots(client, (snapshot) => received.push(snapshot.revision))
	for (const listener of listeners) listener({ revision: 2, cursor: '2', entries: { 'term-a:session-a:agent-a': entry({ unread: false }) } })
	unsubscribe()
	for (const listener of listeners) listener({ revision: 3, cursor: '3', entries: {} })
	assert.deepEqual(received, [1, 2])
})
