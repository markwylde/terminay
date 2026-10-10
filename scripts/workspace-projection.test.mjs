import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { withGeneralFolders } from './support/workspaceFolders.mjs'

// How a client's workspace projection advances (ADR-0059): by the change
// record on the change event, without asking the server anything, and keeping
// the identity of every object the change left alone.

globalThis.window = Object.assign(globalThis, {
	__terminayRendererDiagnostic() {},
})

const outputDirectory = await mkdtemp(join(process.cwd(), 'scripts', '.workspace-projection-'))
await build({ absWorkingDir: process.cwd(), bundle: true, entryPoints: ['src/shared/WorkspaceSnapshotStore.ts', 'src/shared/workspaceProjection.ts'], format: 'esm', outdir: outputDirectory, platform: 'node' })
const { WorkspaceSnapshotStore } = await import(pathToFileURL(join(outputDirectory, 'WorkspaceSnapshotStore.js')).href)
const { applyWorkspaceChangeRecords, shareUnchangedWorkspaceObjects, advanceByWorkspaceDelta, WorkspaceChangeGapError } = await import(pathToFileURL(join(outputDirectory, 'workspaceProjection.js')).href)
test.after(async () => { await rm(outputDirectory, { recursive: true, force: true }) })

const sidebar = { fileExplorerWidth: 280, isFileExplorerOpen: false, isExplorerPaneCollapsed: false, isAgentsPaneCollapsed: false, isGitPaneCollapsed: false, isDocumentationPaneCollapsed: true, expandedAgentEntryIds: [], expandedDocumentationFolderIds: [], sidebarAgentsHeight: 200, sidebarExplorerHeight: 320, sidebarGitHeight: 240, sidebarDocumentationHeight: 220, sidebarPanelOrder: ['explorer', 'agents', 'git', 'documentation'] }

/** Two projects: `project-a` with `panelsA`, `project-b` with one terminal. */
function state(revision, panelsA = ['panel-a1', 'panel-a2'], titles = {}) {
	const panel = (id, projectId) => ({ id, projectId, type: 'terminal', sessionId: `session-${id}`, ...(titles[id] === undefined ? {} : { title: titles[id] }) })
	const session = (id, projectId) => ({ id: `session-${id}`, serverId: 'server-a', projectId, status: 'running' })
	return withGeneralFolders({
		schemaVersion: 6,
		serverId: 'server-a',
		revision,
		cursor: String(revision),
		viewOrder: ['view-a'],
		views: { 'view-a': { id: 'view-a', serverId: 'server-a', name: 'Workspace', projectIds: ['project-a', 'project-b'], activeProjectId: 'project-a' } },
		projects: {
			'project-a': { id: 'project-a', serverId: 'server-a', viewId: 'view-a', name: 'A', root: '/workspace/a', rootOrigin: 'explicit', sidebar, panelIds: panelsA, activePanelId: panelsA.at(-1) },
			'project-b': { id: 'project-b', serverId: 'server-a', viewId: 'view-a', name: 'B', root: '/workspace/b', rootOrigin: 'explicit', sidebar, panelIds: ['panel-b1'], activePanelId: 'panel-b1' },
		},
		panels: Object.fromEntries([...panelsA.map((id) => [id, panel(id, 'project-a')]), ['panel-b1', panel('panel-b1', 'project-b')]]),
		terminalSessions: Object.fromEntries([...panelsA.map((id) => [`session-${id}`, session(id, 'project-a')]), ['session-panel-b1', session('panel-b1', 'project-b')]]),
	})
}

/** The record that takes one state to another, as a server derives it. */
function recordBetween(previous, next, type = 'panel.update') {
	const changed = {}
	const removed = {}
	for (const collection of ['views', 'projects', 'folders', 'panels', 'terminalSessions']) {
		for (const [id, object] of Object.entries(next[collection])) {
			if (JSON.stringify(previous[collection][id]) === JSON.stringify(object)) continue
			changed[collection] = { ...changed[collection], [id]: object }
		}
		for (const id of Object.keys(previous[collection])) {
			if (id in next[collection]) continue
			removed[collection] = [...(removed[collection] ?? []), id]
		}
	}
	return { fromRevision: previous.revision, revision: next.revision, cursor: next.cursor, type, changed, removed }
}

function fakeClient({ snapshots = [], deltas = [] }) {
	let eventListener
	let resyncListener
	const calls = []
	return {
		calls,
		queries: () => calls.map(([operation]) => operation),
		emitChange(revision, record) { eventListener?.({ payload: { serverId: 'server-a', revision, cursor: String(revision), projectId: null, ...(record === undefined ? {} : { record }) } }) },
		emitResync() { resyncListener?.() },
		async query(operation, payload) {
			calls.push([operation, payload])
			if (operation === 'workspace.snapshot') return { result: await snapshots.shift() }
			if (operation === 'workspace.delta') return { result: await deltas.shift() }
			throw new Error(`unexpected operation ${operation}`)
		},
		async subscribe() {
			return {
				onEvent(listener) { eventListener = listener; return () => { eventListener = undefined } },
				onResync(listener) { resyncListener = listener; return () => { resyncListener = undefined } },
				async unsubscribe() {},
			}
		},
	}
}

async function started(client) {
	const store = new WorkspaceSnapshotStore({ client, serverId: 'server-a' })
	await store.start()
	const published = []
	store.subscribe((snapshot, change) => published.push({ snapshot, previous: change.previous }))
	published.length = 0
	return { store, published }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test('a change event with its record advances the projection without a query', async () => {
	const before = state(1)
	const after = state(2, ['panel-a1', 'panel-a2'], { 'panel-a1': 'api' })
	const client = fakeClient({ snapshots: [before] })
	const { store, published } = await started(client)
	const held = store.snapshot

	client.emitChange(2, recordBetween(before, after))

	assert.deepEqual(client.queries(), ['workspace.snapshot'], 'no query was sent for the change')
	assert.equal(store.snapshot.revision, 2)
	assert.equal(store.snapshot.panels['panel-a1'].title, 'api')
	assert.equal(published.length, 1)
	assert.equal(published[0].previous, held)
	assert.equal(store.status.state, 'current')
	store.close()
})

test('every object a change left alone is the same object afterwards', async () => {
	const before = state(1)
	const after = state(2, ['panel-a1', 'panel-a2'], { 'panel-a1': 'api' })
	const client = fakeClient({ snapshots: [before] })
	const { store } = await started(client)
	const held = store.snapshot

	client.emitChange(2, recordBetween(before, after))

	const next = store.snapshot
	assert.notEqual(next, held)
	assert.notEqual(next.panels['panel-a1'], held.panels['panel-a1'])
	assert.equal(next.panels['panel-a2'], held.panels['panel-a2'])
	assert.equal(next.panels['panel-b1'], held.panels['panel-b1'])
	// A collection the record does not name is the collection it was.
	for (const collection of ['views', 'projects', 'folders', 'terminalSessions'])
		assert.equal(next[collection], held[collection], collection)
	assert.equal(next.viewOrder, held.viewOrder)
	store.close()
})

test('a record that starts from a later revision is a missed change: nothing is applied and a delta is requested', async () => {
	const one = state(1)
	const two = state(2, ['panel-a1', 'panel-a2'], { 'panel-a1': 'api' })
	const three = state(3, ['panel-a1'], { 'panel-a1': 'api' })
	const client = fakeClient({ snapshots: [one], deltas: [{ deltaVersion: 2, serverId: 'server-a', fromRevision: 1, fromCursor: '1', revision: 3, cursor: '3', records: [recordBetween(one, two), recordBetween(two, three, 'panel.close')] }] })
	const { store, published } = await started(client)

	client.emitChange(3, recordBetween(two, three, 'panel.close'))
	// Declined synchronously: the projection is exactly what it was.
	assert.equal(store.snapshot.revision, 1)
	assert.equal(published.length, 0)
	await settle()

	assert.deepEqual(client.calls.at(-1), ['workspace.delta', { revision: 1, cursor: '1' }])
	assert.equal(store.snapshot.revision, 3)
	assert.equal(store.snapshot.panels['panel-a2'], undefined)
	assert.equal(store.snapshot.panels['panel-a1'].title, 'api')
	// Both missed records arrive as one atomic advance.
	assert.deepEqual(published.map(({ snapshot }) => snapshot.revision), [3])
	store.close()
})

test('a record for a revision already reached is ignored', async () => {
	const one = state(1)
	const two = state(2, ['panel-a1', 'panel-a2'], { 'panel-a1': 'api' })
	const client = fakeClient({ snapshots: [one] })
	const { store, published } = await started(client)
	const record = recordBetween(one, two)

	client.emitChange(2, record)
	const reached = store.snapshot
	client.emitChange(2, record)
	client.emitChange(1, recordBetween(state(0), one))
	await settle()

	assert.equal(store.snapshot, reached)
	assert.equal(published.length, 1)
	assert.deepEqual(client.queries(), ['workspace.snapshot'])
	store.close()
})

test('records delivered out of order converge through one delta', async () => {
	const one = state(1)
	const two = state(2, ['panel-a1', 'panel-a2'], { 'panel-a1': 'api' })
	const three = state(3, ['panel-a1', 'panel-a2'], { 'panel-a1': 'api', 'panel-a2': 'db' })
	const client = fakeClient({ snapshots: [one], deltas: [{ deltaVersion: 2, serverId: 'server-a', fromRevision: 1, fromCursor: '1', revision: 3, cursor: '3', records: [recordBetween(one, two), recordBetween(two, three)] }] })
	const { store } = await started(client)

	client.emitChange(3, recordBetween(two, three))
	client.emitChange(2, recordBetween(one, two))
	await settle()
	await settle()

	assert.equal(store.snapshot.revision, 3)
	assert.equal(store.snapshot.panels['panel-a2'].title, 'db')
	assert.equal(client.queries().filter((operation) => operation === 'workspace.delta').length, 1)
	store.close()
})

test('a malformed or invalid record changes nothing and falls back to a delta', async () => {
	const one = state(1)
	const two = state(2, ['panel-a1', 'panel-a2'], { 'panel-a1': 'api' })
	const good = recordBetween(one, two)
	const bad = [
		{ ...good, changed: { gadgets: {} } },
		{ ...good, changed: { panels: { 'panel-a1': { id: 'panel-zz' } } } },
		// Well formed, but it would leave a panel in a project that is gone.
		{ ...good, changed: {}, removed: { projects: ['project-b'] } },
		// Names a session's project that disagrees with its panel.
		{ ...good, changed: { panels: { 'panel-a1': { ...two.panels['panel-a1'], projectId: 'project-b' } } } },
	]
	for (const record of bad) {
		const client = fakeClient({ snapshots: [one], deltas: [{ deltaVersion: 2, serverId: 'server-a', fromRevision: 1, fromCursor: '1', revision: 2, cursor: '2', records: [good] }] })
		const { store, published } = await started(client)
		const held = store.snapshot
		client.emitChange(2, record)
		assert.equal(store.snapshot, held, 'the projection is not partially mutated')
		assert.equal(published.length, 0)
		await settle()
		assert.equal(store.snapshot.revision, 2)
		assert.equal(store.snapshot.panels['panel-a1'].title, 'api')
		store.close()
	}
})

test('an event without a record, from a server that sends none, is answered with a delta of either version', async () => {
	const one = state(1)
	const two = state(2, ['panel-a1', 'panel-a2'], { 'panel-a1': 'api' })
	const client = fakeClient({ snapshots: [one], deltas: [{ deltaVersion: 1, serverId: 'server-a', fromRevision: 1, fromCursor: '1', revision: 2, cursor: '2', state: two, events: [] }] })
	const { store } = await started(client)
	const held = store.snapshot

	client.emitChange(2)
	await settle()

	assert.equal(store.snapshot.revision, 2)
	assert.equal(store.snapshot.panels['panel-a1'].title, 'api')
	// A whole state still disturbs only what differs.
	assert.equal(store.snapshot.panels['panel-a2'], held.panels['panel-a2'])
	assert.equal(store.snapshot.projects, held.projects)
	assert.equal(store.snapshot.terminalSessions, held.terminalSessions)
	store.close()
})

test('a snapshot after a resync keeps every object that did not change while away', async () => {
	const one = state(1)
	const later = state(9, ['panel-a1', 'panel-a2'], { 'panel-b1': 'db' })
	const client = fakeClient({ snapshots: [one, later] })
	const { store } = await started(client)
	const held = store.snapshot

	client.emitResync()
	await settle()

	assert.equal(store.snapshot.revision, 9)
	assert.notEqual(store.snapshot.panels['panel-b1'], held.panels['panel-b1'])
	assert.equal(store.snapshot.panels['panel-a1'], held.panels['panel-a1'])
	assert.equal(store.snapshot.projects['project-a'], held.projects['project-a'])
	assert.equal(store.snapshot.projects, held.projects)
	assert.equal(store.snapshot.folders, held.folders)
	assert.equal(store.snapshot.viewOrder, held.viewOrder)
	store.close()
})

test('a records delta whose history is gone carries a state, which is shared the same way', () => {
	const one = state(1)
	const later = state(7, ['panel-a1', 'panel-a2'], { 'panel-a2': 'db' })
	const next = advanceByWorkspaceDelta(one, { deltaVersion: 2, serverId: 'server-a', fromRevision: 1, fromCursor: '1', revision: 7, cursor: '7', state: later }, 'server-a')
	assert.equal(next.revision, 7)
	assert.equal(next.panels['panel-a2'].title, 'db')
	assert.equal(next.panels['panel-a1'], one.panels['panel-a1'])
	assert.equal(next.projects, one.projects)
})

test('a selection hears only changes to what it selects', async () => {
	const one = state(1)
	const two = state(2, ['panel-a1', 'panel-a2'], { 'panel-a1': 'api' })
	const three = state(3, ['panel-a1', 'panel-a2'], { 'panel-a1': 'api', 'panel-b1': 'db' })
	const client = fakeClient({ snapshots: [one] })
	const { store } = await started(client)
	const heard = { a1: [], b1: [], projectA: [], order: [], any: 0 }
	store.subscribeSelection((snapshot) => snapshot?.panels['panel-a1'], (panel) => heard.a1.push(panel.title))
	store.subscribeSelection((snapshot) => snapshot?.panels['panel-b1'], (panel) => heard.b1.push(panel.title))
	store.subscribeSelection((snapshot) => snapshot?.projects['project-a'], (project) => heard.projectA.push(project))
	store.subscribeSelection((snapshot) => snapshot?.views['view-a']?.projectIds, (ids) => heard.order.push(ids))
	const stop = store.subscribeAny(() => { heard.any += 1 })

	client.emitChange(2, recordBetween(one, two))
	assert.deepEqual(heard, { a1: ['api'], b1: [], projectA: [], order: [], any: 1 })
	client.emitChange(3, recordBetween(two, three))
	assert.deepEqual(heard, { a1: ['api'], b1: ['db'], projectA: [], order: [], any: 2 })

	stop()
	client.emitChange(4, recordBetween(three, state(4, ['panel-a1', 'panel-a2'], { 'panel-a1': 'web', 'panel-b1': 'db' })))
	assert.equal(heard.any, 2)
	assert.deepEqual(heard.a1, ['api', 'web'])
	store.close()
})

test('a run of records is applied all or nothing', () => {
	const one = state(1)
	const two = state(2, ['panel-a1', 'panel-a2'], { 'panel-a1': 'api' })
	const three = state(3, ['panel-a1'], { 'panel-a1': 'api' })
	const next = applyWorkspaceChangeRecords(one, [recordBetween(one, two), recordBetween(two, three, 'panel.close')], 'server-a')
	assert.equal(next.revision, 3)
	assert.equal(next.panels['panel-a2'], undefined)
	assert.equal(next.panels['panel-b1'], one.panels['panel-b1'])
	// No records, no change, same object.
	assert.equal(applyWorkspaceChangeRecords(one, [], 'server-a'), one)
	// The second record does not follow the first.
	assert.throws(() => applyWorkspaceChangeRecords(one, [recordBetween(one, two), recordBetween(one, two)], 'server-a'), WorkspaceChangeGapError)
	assert.throws(() => applyWorkspaceChangeRecords(one, [recordBetween(two, three)], 'server-a'), WorkspaceChangeGapError)
	// A record from another server's workspace is not this projection's.
	assert.throws(() => applyWorkspaceChangeRecords(one, [recordBetween(one, two)], 'server-b'))
	// The held projection was never touched.
	assert.equal(one.revision, 1)
	assert.equal(one.panels['panel-a1'].title, undefined)
})

test('sharing a snapshot with itself or with nothing is the identity', () => {
	const one = state(1)
	assert.equal(shareUnchangedWorkspaceObjects(null, one), one)
	assert.equal(shareUnchangedWorkspaceObjects(one, one), one)
	const same = shareUnchangedWorkspaceObjects(one, state(2))
	assert.equal(same.revision, 2)
	for (const collection of ['views', 'projects', 'folders', 'panels', 'terminalSessions'])
		assert.equal(same[collection], one[collection], collection)
})
