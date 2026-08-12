export type ServerWorkspacePanel = Readonly<{
	id: string
	projectId: string
	type: 'terminal' | 'file' | 'folder'
	title?: string
	emoji?: string
	color?: string
	inheritsProjectColor?: boolean
	activityIndicatorsEnabled?: boolean
	sessionId?: string
	cwd?: string
	path?: string
}>

export type ServerWorkspaceProject = Readonly<{
	id: string
	serverId: string
	name: string
	root: string
	rootOrigin: 'explicit' | 'server-default' | 'legacy-unverified'
	color?: string
	icon?: string
	viewId: string
	projectEnvironmentId: string
	environmentRevision: number
	panelIds: readonly string[]
	activePanelId?: string
	defaultShellProfileId?: string
}>

export type ServerWorkspaceView = Readonly<{
	id: string
	name: string
	serverId: string
	projectIds: readonly string[]
	activeProjectId?: string
}>

export type ServerWorkspaceSnapshot = Readonly<{
	schemaVersion: number
	cursor: string
	revision: number
	serverId: string
	viewOrder: readonly string[]
	views: Readonly<Record<string, ServerWorkspaceView>>
	projects: Readonly<Record<string, ServerWorkspaceProject>>
	panels: Readonly<Record<string, ServerWorkspacePanel>>
	terminalSessions: Readonly<Record<string, Readonly<{ id: string; serverId: string; projectId: string; projectEnvironmentId: string; environmentRevision: number }>>>
}>

export type ServerWorkspaceSelection = Readonly<{ viewId: string | null; projectId: string | null; panelId: string | null }>

export type ServerWorkspaceDelta = Readonly<{
	state: ServerWorkspaceSnapshot
	events: WorkspaceDeltaDto['events']
}>

/**
 * Keep presentation selection constrained to the latest authenticated server
 * snapshot. A closed/moved panel therefore cannot leave a browser pointing at
 * an invented terminal identity.
 */
export function reconcileServerWorkspaceSelection(snapshot: ServerWorkspaceSnapshot, previous: ServerWorkspaceSelection): ServerWorkspaceSelection {
	const view = snapshot.views[previous.viewId ?? ''] ?? snapshot.views[snapshot.viewOrder[0] ?? '']
	if (view === undefined) return { viewId: null, projectId: null, panelId: null }
	const project = view.projectIds.map((id) => snapshot.projects[id]).find((candidate) => candidate?.id === previous.projectId)
		?? snapshot.projects[view.activeProjectId ?? '']
		?? view.projectIds.map((id) => snapshot.projects[id]).find((candidate) => candidate !== undefined)
	if (project === undefined) return { viewId: view.id, projectId: null, panelId: null }
	const panel = project.panelIds.map((id) => snapshot.panels[id]).find((candidate) => candidate?.id === previous.panelId)
		?? snapshot.panels[project.activePanelId ?? '']
		?? project.panelIds.map((id) => snapshot.panels[id]).find((candidate) => candidate !== undefined)
	return { viewId: view.id, projectId: project.id, panelId: panel?.id ?? null }
}

export function parseServerWorkspaceSnapshot(value: unknown, expectedServerId: string, previous?: ServerWorkspaceSnapshot | null): ServerWorkspaceSnapshot {
	if (!isRecord(value)) throw new Error('The server returned an incompatible workspace snapshot.')
	const { schemaVersion, serverId, revision, cursor, viewOrder, views, projects, panels, terminalSessions } = value
	if (schemaVersion !== 3 || serverId !== expectedServerId || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 || typeof cursor !== 'string' || cursor !== String(revision) || !isStringArray(viewOrder) || !isRecord(views) || !isRecord(projects) || !isRecord(panels) || !isRecord(terminalSessions)) throw new Error('The server returned an incompatible workspace snapshot.')
	const snapshot = value as unknown as ServerWorkspaceSnapshot
	if (previous !== undefined && previous !== null && (snapshot.revision < previous.revision || (snapshot.revision === previous.revision && snapshot.cursor !== previous.cursor))) throw new Error('The server returned a stale workspace snapshot.')
	if (new Set(snapshot.viewOrder).size !== snapshot.viewOrder.length || snapshot.viewOrder.some((id) => snapshot.views[id]?.id !== id)) throw new Error('The server returned invalid workspace view references.')
	for (const [id, view] of Object.entries(snapshot.views)) {
		if (view.id !== id || view.serverId !== expectedServerId || !isStringArray(view.projectIds) || new Set(view.projectIds).size !== view.projectIds.length || view.projectIds.some((projectId) => snapshot.projects[projectId]?.id !== projectId || snapshot.projects[projectId]?.viewId !== id)) throw new Error('The server returned invalid workspace project references.')
		if (view.activeProjectId !== undefined && !view.projectIds.includes(view.activeProjectId)) throw new Error('The server returned an invalid active project.')
	}
	for (const [id, project] of Object.entries(snapshot.projects)) {
		if (project.id !== id || project.serverId !== expectedServerId || typeof project.projectEnvironmentId !== 'string' || !isPositiveSafeInteger(project.environmentRevision) || typeof project.name !== 'string' || typeof project.root !== 'string' || !['explicit', 'server-default', 'environment-default', 'legacy-unverified'].includes(project.rootOrigin) || (project.color !== undefined && typeof project.color !== 'string') || (project.icon !== undefined && typeof project.icon !== 'string') || (project.defaultShellProfileId !== undefined && typeof project.defaultShellProfileId !== 'string') || snapshot.views[project.viewId]?.projectIds.includes(project.id) !== true || !isStringArray(project.panelIds) || new Set(project.panelIds).size !== project.panelIds.length || project.panelIds.some((panelId) => snapshot.panels[panelId]?.id !== panelId || snapshot.panels[panelId]?.projectId !== project.id)) throw new Error('The server returned invalid workspace panel references.')
		if (project.activePanelId !== undefined && !project.panelIds.includes(project.activePanelId)) throw new Error('The server returned an invalid active panel.')
	}
	for (const [id, panel] of Object.entries(snapshot.panels)) {
		if (panel.id !== id || !['terminal', 'file', 'folder'].includes(panel.type) || snapshot.projects[panel.projectId] === undefined || (panel.title !== undefined && typeof panel.title !== 'string') || (panel.emoji !== undefined && typeof panel.emoji !== 'string') || (panel.color !== undefined && typeof panel.color !== 'string') || (panel.inheritsProjectColor !== undefined && typeof panel.inheritsProjectColor !== 'boolean') || (panel.activityIndicatorsEnabled !== undefined && typeof panel.activityIndicatorsEnabled !== 'boolean') || (panel.type === 'terminal' && (panel.sessionId === undefined || snapshot.terminalSessions[panel.sessionId]?.projectId !== panel.projectId))) throw new Error('The server returned an invalid workspace panel.')
	}
	for (const [id, session] of Object.entries(snapshot.terminalSessions)) {
		const project = snapshot.projects[session.projectId]
		if (session.id !== id || session.serverId !== expectedServerId || project === undefined || session.projectEnvironmentId !== project.projectEnvironmentId || session.environmentRevision !== project.environmentRevision) throw new Error('The server returned an invalid terminal session.')
	}
	return snapshot
}

export function parseServerWorkspaceDelta(value: unknown, expectedServerId: string, previous: ServerWorkspaceSnapshot): ServerWorkspaceDelta {
	const delta = parseWorkspaceDeltaDto(value, {
		serverId: expectedServerId,
		revision: previous.revision,
		cursor: previous.cursor,
	})
	const state = parseServerWorkspaceSnapshot(delta.state, expectedServerId, previous)
	if (delta.revision !== state.revision || delta.cursor !== state.cursor) {
		throw new Error('The server returned a workspace delta that disagrees with its state.')
	}
	for (const event of delta.events) {
		if (event.revision <= previous.revision || event.revision > state.revision) {
			throw new Error('The server returned an out-of-bounds workspace change.')
		}
	}
	return { state, events: delta.events }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function isStringArray(value: unknown): value is readonly string[] { return Array.isArray(value) && value.every((entry) => typeof entry === 'string') }
function isPositiveSafeInteger(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 }
import { parseWorkspaceDeltaDto, type WorkspaceDeltaDto } from '@terminay/protocol'
