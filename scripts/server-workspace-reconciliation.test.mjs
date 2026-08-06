import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const outputDirectory = await mkdtemp(join(process.cwd(), 'scripts', '.server-workspace-reconciliation-'))
await build({ absWorkingDir: process.cwd(), bundle: true, entryPoints: ['src/shared/serverWorkspaceReconciliation.ts'], format: 'esm', outdir: outputDirectory, platform: 'node' })
const { parseServerWorkspaceSnapshot, reconcileServerWorkspaceSelection } = await import(pathToFileURL(join(outputDirectory, 'serverWorkspaceReconciliation.js')).href)

test.after(async () => { await rm(outputDirectory, { recursive: true, force: true }) })

function snapshot({ revision = 2, projectIds = ['project-a'], panelIds = ['panel-a'], activePanelId = 'panel-a' } = {}) {
	return {
		schemaVersion: 2, serverId: 'server-a', revision, cursor: String(revision), viewOrder: ['view-a'],
		views: { 'view-a': { id: 'view-a', serverId: 'server-a', name: 'Workspace', projectIds, activeProjectId: projectIds[0] } },
		projects: Object.fromEntries(projectIds.map((id) => [id, { id, serverId: 'server-a', viewId: 'view-a', name: id, root: `/workspace/${id}`, rootOrigin: 'explicit', panelIds: id === 'project-a' ? panelIds : [], ...(id === 'project-a' && activePanelId !== undefined ? { activePanelId } : {}) }])),
		panels: Object.fromEntries(panelIds.map((id) => [id, { id, projectId: 'project-a', type: 'terminal', sessionId: `session-${id}` }])),
		terminalSessions: Object.fromEntries(panelIds.map((id) => [`session-${id}`, { id: `session-${id}`, serverId: 'server-a', projectId: 'project-a' }])),
	}
}

test('reconciles a closed selection to the active server panel', () => {
	const state = parseServerWorkspaceSnapshot(snapshot({ panelIds: ['panel-b'], activePanelId: 'panel-b' }), 'server-a')
	assert.deepEqual(reconcileServerWorkspaceSelection(state, { viewId: 'view-a', projectId: 'project-a', panelId: 'panel-a' }), { viewId: 'view-a', projectId: 'project-a', panelId: 'panel-b' })
})

test('accepts a history-expired full delta and rejects stale or crossed ownership state', () => {
	const known = parseServerWorkspaceSnapshot(snapshot({ revision: 2 }), 'server-a')
	assert.equal(parseServerWorkspaceSnapshot(snapshot({ revision: 3 }), 'server-a', known).revision, 3)
	assert.throws(() => parseServerWorkspaceSnapshot(snapshot({ revision: 1 }), 'server-a', known), /stale/u)
	const broken = snapshot()
	broken.panels['panel-a'].projectId = 'project-missing'
	assert.throws(() => parseServerWorkspaceSnapshot(broken, 'server-a'), /invalid workspace panel/u)
})

test('project and panel identity survives project switches and detach-reattach snapshots', () => {
	const workspace = (revision, activeProjectId, projectPanels) => {
		const projectIds = Object.keys(projectPanels)
		const panels = Object.fromEntries(projectIds.flatMap((projectId) =>
			projectPanels[projectId].map((panelId) => [
				panelId,
				{ id: panelId, projectId, type: 'terminal', sessionId: `session-${panelId}` },
			])))
		const terminalSessions = Object.fromEntries(Object.values(panels).map((panel) => [
			panel.sessionId,
			{ id: panel.sessionId, serverId: 'server-a', projectId: panel.projectId },
		]))
		return {
			schemaVersion: 2,
			serverId: 'server-a',
			revision,
			cursor: String(revision),
			viewOrder: ['view-a'],
			views: {
				'view-a': {
					id: 'view-a',
					serverId: 'server-a',
					name: 'Workspace',
					projectIds,
					activeProjectId,
				},
			},
			projects: Object.fromEntries(projectIds.map((projectId) => [
				projectId,
				{
					id: projectId,
					serverId: 'server-a',
					viewId: 'view-a',
					name: projectId,
					root: `/workspace/${projectId}`,
					rootOrigin: 'explicit',
					panelIds: projectPanels[projectId],
					...(projectPanels[projectId][0] === undefined ? {} : { activePanelId: projectPanels[projectId][0] }),
				},
			])),
			panels,
			terminalSessions,
		}
	}

	const initial = parseServerWorkspaceSnapshot(
		workspace(1, 'project-a', { 'project-a': ['panel-a'], 'project-b': ['panel-b'] }),
		'server-a',
	)
	assert.deepEqual(
		reconcileServerWorkspaceSelection(initial, { viewId: null, projectId: null, panelId: null }),
		{ viewId: 'view-a', projectId: 'project-a', panelId: 'panel-a' },
	)

	const switched = parseServerWorkspaceSnapshot(
		workspace(2, 'project-b', { 'project-a': ['panel-a'], 'project-b': ['panel-b'] }),
		'server-a',
		initial,
	)
	const projectBSelection = reconcileServerWorkspaceSelection(
		switched,
		{ viewId: 'view-a', projectId: 'project-b', panelId: 'panel-b' },
	)
	assert.deepEqual(projectBSelection, { viewId: 'view-a', projectId: 'project-b', panelId: 'panel-b' })
	assert.equal(switched.panels[projectBSelection.panelId].sessionId, 'session-panel-b')

	const detached = parseServerWorkspaceSnapshot(
		workspace(3, 'project-b', { 'project-a': ['panel-a'], 'project-b': [] }),
		'server-a',
		switched,
	)
	assert.deepEqual(
		reconcileServerWorkspaceSelection(detached, projectBSelection),
		{ viewId: 'view-a', projectId: 'project-b', panelId: null },
	)

	const reattached = parseServerWorkspaceSnapshot(
		workspace(4, 'project-b', { 'project-a': ['panel-a'], 'project-b': ['panel-b'] }),
		'server-a',
		detached,
	)
	const restored = reconcileServerWorkspaceSelection(
		reattached,
		{ viewId: 'view-a', projectId: 'project-b', panelId: null },
	)
	assert.deepEqual(restored, projectBSelection)
	assert.deepEqual(reattached.terminalSessions['session-panel-b'], {
		id: 'session-panel-b',
		serverId: 'server-a',
		projectId: 'project-b',
	})
})
