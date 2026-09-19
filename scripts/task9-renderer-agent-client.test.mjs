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
		entryId: 'term-a:session-a:agent-a', kind: 'root', provider: 'com.terminay.builtin-agents/agents', agentId: 'agent-a', sessionId: 'session-a', activationTerminalSessionId: 'term-a', terminalSessionId: 'term-a', inProcess: false,
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

test('adapts an external session scoped to projects and keeps it unbound', () => {
	const snapshot = adaptServerAgentSnapshot({ revision: 9, cursor: '9', entries: { 'ext:session-x': entry({ entryId: 'ext:session-x', provider: 'com.terminay.builtin-agents/agents', activationTerminalSessionId: null, terminalSessionId: null, external: true, projectIds: ['project-a'], harness: 'claude-code', harnessDisplayName: 'Claude Code', lastEventKind: undefined, lastEventSequence: undefined }) } })
	const external = snapshot.entries['ext:session-x']
	assert.equal(external.external, true)
	assert.equal(external.activationTerminalSessionId, null)
	assert.equal(external.terminalSessionId, null)
	assert.deepEqual(external.projectIds, ['project-a'])
	assert.equal(external.harnessDisplayName, 'Claude Code')
	assert.throws(() => adaptServerAgentSnapshot({ revision: 10, cursor: '10', entries: { bad: entry({ entryId: 'bad', external: true, activationTerminalSessionId: null }) } }), /root agent shape/u)
	assert.throws(() => adaptServerAgentSnapshot({ revision: 11, cursor: '11', entries: { bad: entry({ entryId: 'bad', projectIds: 'project-a' }) } }), /projectIds/u)
	assert.equal(adaptServerAgentSnapshot({ revision: 12, cursor: '12', entries: { 'term-a:session-a:agent-a': entry() } }).entries['term-a:session-a:agent-a'].external, false)
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

test('drops snapshots from a different process instance after the connection is pinned', () => {
	const listeners = new Set()
	const client = {
		snapshot: { revision: 1, cursor: '1', processInstanceId: 'process-a', entries: { 'term-a:session-a:agent-a': entry() } },
		onChange(listener) { listeners.add(listener); return () => listeners.delete(listener) },
	}
	const received = []
	subscribeServerAgentSnapshots(client, (snapshot) => received.push(snapshot.processInstanceId))
	for (const listener of listeners) listener({ revision: 2, cursor: '2', processInstanceId: 'process-b', entries: { 'term-a:session-a:agent-a': entry({ unread: false }) } })
	for (const listener of listeners) listener({ revision: 3, cursor: '3', processInstanceId: 'process-a', entries: { 'term-a:session-a:agent-a': entry({ unread: false }) } })
	assert.deepEqual(received, ['process-a', 'process-a'])
})
