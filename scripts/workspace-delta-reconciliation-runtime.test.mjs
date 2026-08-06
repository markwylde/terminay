import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

globalThis.window = Object.assign(globalThis, {
	terminayBootstrapDiagnostic: { record() {} },
})

const outputDirectory = await mkdtemp(join(process.cwd(), 'scripts', '.workspace-delta-runtime-'))
await build({ absWorkingDir: process.cwd(), bundle: true, entryPoints: ['src/shared/WorkspaceSnapshotStore.ts'], format: 'esm', outdir: outputDirectory, platform: 'node' })
const { WorkspaceSnapshotStore } = await import(pathToFileURL(join(outputDirectory, 'WorkspaceSnapshotStore.js')).href)
test.after(async () => { await rm(outputDirectory, { recursive: true, force: true }) })

function state(revision, panelIds = ['panel-a']) {
	return {
		schemaVersion: 2,
		serverId: 'server-a',
		revision,
		cursor: String(revision),
		viewOrder: ['view-a'],
		views: { 'view-a': { id: 'view-a', serverId: 'server-a', name: 'Workspace', projectIds: ['project-a'], activeProjectId: 'project-a' } },
		projects: { 'project-a': { id: 'project-a', serverId: 'server-a', viewId: 'view-a', name: 'A', root: '/workspace/a', rootOrigin: 'explicit', panelIds, activePanelId: panelIds.at(-1) } },
		panels: Object.fromEntries(panelIds.map((id) => [id, { id, projectId: 'project-a', type: 'terminal', sessionId: `session-${id}` }])),
		terminalSessions: Object.fromEntries(panelIds.map((id) => [`session-${id}`, { id: `session-${id}`, serverId: 'server-a', projectId: 'project-a' }])),
	}
}

function delta(fromRevision, revision, panelIds = ['panel-a'], events = []) {
	return {
		deltaVersion: 1,
		serverId: 'server-a',
		fromRevision,
		fromCursor: String(fromRevision),
		revision,
		cursor: String(revision),
		state: state(revision, panelIds),
		events,
	}
}

function fakeClient({ snapshots, deltas }) {
	let eventListener
	let resyncListener
	const calls = []
	return {
		calls,
		emitChange(revision) { eventListener?.({ payload: { serverId: 'server-a', revision, cursor: String(revision) } }) },
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

test('applies a validated delta atomically and publishes its resulting state once', async () => {
	const client = fakeClient({ snapshots: [state(1)], deltas: [delta(1, 2, ['panel-a', 'panel-b'], [{ revision: 2, cursor: '2', commandId: 'create-b', type: 'terminal.createPanel', changedIds: ['panel-b', 'session-panel-b'] }])] })
	const store = new WorkspaceSnapshotStore({ client, serverId: 'server-a' })
	const published = []
	store.subscribe((snapshot) => published.push(snapshot))
	await store.start()
	await store.refresh()
	assert.deepEqual(published.map(({ revision }) => revision), [1, 2])
	assert.equal(published.at(-1).panels['panel-b'].sessionId, 'session-panel-b')
	assert.equal(store.status.state, 'current')
	store.close()
})

test('converges live create, activate, move, and close tab projections without polling', async () => {
	const created = delta(1, 2, ['panel-a', 'panel-b'], [{ revision: 2, cursor: '2', commandId: 'create-b', type: 'terminal.createPanel', changedIds: ['panel-b', 'session-panel-b'] }])
	const activated = delta(2, 3, ['panel-a', 'panel-b'], [{ revision: 3, cursor: '3', commandId: 'activate-b', type: 'panel.activate', changedIds: ['project-a', 'panel-b'] }])
	const moved = delta(3, 4, ['panel-b', 'panel-a'], [{ revision: 4, cursor: '4', commandId: 'move-b', type: 'panel.reorder', changedIds: ['project-a', 'panel-b', 'panel-a'] }])
	const closed = delta(4, 5, ['panel-a'], [{ revision: 5, cursor: '5', commandId: 'close-b', type: 'panel.close', changedIds: ['project-a', 'panel-b', 'session-panel-b'] }])
	const client = fakeClient({ snapshots: [state(1)], deltas: [created, activated, moved, closed] })
	const store = new WorkspaceSnapshotStore({ client, serverId: 'server-a' })
	await store.start()
	await store.refresh()
	assert.equal(store.snapshot.projects['project-a'].activePanelId, 'panel-b')
	await store.refresh()
	assert.equal(store.snapshot.projects['project-a'].activePanelId, 'panel-b')
	await store.refresh()
	assert.deepEqual(store.snapshot.projects['project-a'].panelIds, ['panel-b', 'panel-a'])
	await store.refresh()
	assert.deepEqual(store.snapshot.projects['project-a'].panelIds, ['panel-a'])
	assert.equal(store.snapshot.panels['panel-b'], undefined)
	assert.equal(store.snapshot.terminalSessions['session-panel-b'], undefined)
	store.close()
})

test('retains the confirmed projection and performs one bounded snapshot recovery after a stale delta', async () => {
	const stale = { ...delta(1, 2, ['panel-a', 'panel-b']), fromRevision: 0, fromCursor: '0' }
	const client = fakeClient({ snapshots: [state(1), state(2, ['panel-a', 'panel-b'])], deltas: [stale] })
	const store = new WorkspaceSnapshotStore({ client, serverId: 'server-a' })
	const statuses = []
	const published = []
	store.subscribeStatus(({ state: value }) => statuses.push(value))
	store.subscribe(({ revision }) => published.push(revision))
	await store.start()
	await store.refresh()
	assert.deepEqual(published, [1, 2])
	assert.deepEqual(statuses, ['stale', 'current', 'stale', 'current'])
	assert.deepEqual(client.calls.map(([operation]) => operation), ['workspace.snapshot', 'workspace.delta', 'workspace.snapshot'])
	store.close()
})

test('reports failed recovery without replacing the last confirmed projection', async () => {
	const client = fakeClient({ snapshots: [state(1), Promise.reject(new Error('snapshot unavailable'))], deltas: [{ broken: true }] })
	const store = new WorkspaceSnapshotStore({ client, serverId: 'server-a' })
	await store.start()
	await assert.rejects(store.refresh(), /snapshot unavailable/)
	assert.equal(store.snapshot.revision, 1)
	assert.equal(store.status.state, 'failed')
	store.close()
})

test('coalesces changes arriving during refresh and cannot publish a regressing revision', async () => {
	let releaseFirst
	const first = new Promise((resolve) => { releaseFirst = () => resolve(delta(1, 2, ['panel-a', 'panel-b'])) })
	const client = fakeClient({ snapshots: [state(1)], deltas: [first, delta(2, 3, ['panel-a', 'panel-b', 'panel-c'])] })
	const store = new WorkspaceSnapshotStore({ client, serverId: 'server-a' })
	const revisions = []
	store.subscribe(({ revision }) => revisions.push(revision))
	await store.start()
	const refreshing = store.refresh()
	client.emitChange(2)
	client.emitChange(3)
	releaseFirst()
	const settled = await refreshing
	assert.equal(settled.revision, 3)
	assert.deepEqual(revisions, [1, 2, 3])
	assert.deepEqual(client.calls.filter(([operation]) => operation === 'workspace.delta').map(([, payload]) => payload.revision), [1, 2])
	store.close()
})

test('resync preserves stale state until a full authorized snapshot is published', async () => {
	const client = fakeClient({ snapshots: [state(1), state(2, ['panel-a', 'panel-b'])], deltas: [] })
	const store = new WorkspaceSnapshotStore({ client, serverId: 'server-a' })
	await store.start()
	client.emitResync()
	assert.equal(store.snapshot.revision, 1)
	assert.equal(store.status.state, 'stale')
	await new Promise((resolve) => setTimeout(resolve, 0))
	assert.equal(store.snapshot.revision, 2)
	assert.equal(store.status.state, 'current')
	store.close()
})
