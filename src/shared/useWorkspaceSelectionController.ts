import { useEffect, useRef, useState } from 'react'
import {
	reconcileServerWorkspaceSelection,
	type ServerWorkspacePanel,
	type ServerWorkspaceProject,
	type ServerWorkspaceSnapshot,
	type ServerWorkspaceView,
} from './serverWorkspaceReconciliation'
import { WorkspaceSnapshotStore } from './WorkspaceSnapshotStore'

export interface WorkspaceSelectionController {
	readonly snapshot: ServerWorkspaceSnapshot | null
	readonly error: string | null
	readonly selectedView: ServerWorkspaceView | undefined
	readonly selectedProject: ServerWorkspaceProject | undefined
	readonly selectedPanel: ServerWorkspacePanel | undefined
	readonly views: readonly ServerWorkspaceView[]
	readonly projects: readonly ServerWorkspaceProject[]
	readonly activateView: (viewId: string) => void
	readonly activateProject: (projectId: string) => void
	readonly activatePanel: (panel: ServerWorkspacePanel) => void
}

/** Shared authenticated workspace snapshot and selection lifecycle.
 *
 * The connection context owns the one WorkspaceSnapshotStore for a server.
 * Do not recreate a WorkspaceClient or a second polling loop here: doing so
 * would give compatibility renderers a competing workspace projection. */
export function useWorkspaceSelectionController(workspaceSnapshotStore: WorkspaceSnapshotStore): WorkspaceSelectionController {
	const [snapshot, setSnapshot] = useState<ServerWorkspaceSnapshot | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
	const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null)
	const [selectedViewId, setSelectedViewId] = useState<string | null>(null)
	const selectionRef = useRef({ viewId: null as string | null, projectId: null as string | null, panelId: null as string | null })

	useEffect(() => {
		let disposed = false
		setSnapshot(null); setError(null); setSelectedProjectId(null); setSelectedPanelId(null); setSelectedViewId(null)
		selectionRef.current = { viewId: null, projectId: null, panelId: null }
		const accept = (parsed: ServerWorkspaceSnapshot) => {
			if (disposed) return
			const selection = reconcileServerWorkspaceSelection(parsed, selectionRef.current)
			selectionRef.current = selection
			setSnapshot(parsed); setSelectedViewId(selection.viewId); setSelectedProjectId(selection.projectId); setSelectedPanelId(selection.panelId)
		}
		const unsubscribe = workspaceSnapshotStore.subscribe(accept)
		const unsubscribeStatus = workspaceSnapshotStore.subscribeStatus((status) => {
			if (disposed) return
			if (status.state === 'current') {
				setError(null)
				return
			}
			setError(status.error?.message ?? (status.state === 'stale'
				? 'The server workspace is stale while Terminay resynchronizes it.'
				: 'Unable to synchronize the server workspace.'))
		})
		void workspaceSnapshotStore.start().catch((cause: unknown) => {
			if (!disposed) setError(cause instanceof Error ? cause.message : 'Unable to synchronize the server workspace.')
		})
		return () => { disposed = true; unsubscribe(); unsubscribeStatus() }
	}, [workspaceSnapshotStore])

	const selectedView = selectView(snapshot, selectedViewId)
	const selectedProject = selectProject(snapshot, selectedView, selectedProjectId)
	const selectedPanel = selectPanel(snapshot, selectedProject, selectedPanelId)
	return {
		snapshot, error, selectedView, selectedProject, selectedPanel,
		views: viewsForSnapshot(snapshot), projects: projectsForView(snapshot, selectedView),
		activateView: (viewId) => { selectionRef.current = { viewId, projectId: null, panelId: null }; setSelectedViewId(viewId); setSelectedProjectId(null); setSelectedPanelId(null); setError(null) },
		activateProject: (projectId) => { selectionRef.current = { ...selectionRef.current, projectId, panelId: null }; setSelectedProjectId(projectId); setSelectedPanelId(null); setError(null) },
		activatePanel: (panel) => {
			selectionRef.current = { ...selectionRef.current, panelId: panel.id }; setSelectedPanelId(panel.id); setError(null)
			void workspaceSnapshotStore.activatePanel({ projectId: panel.projectId, panelId: panel.id }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to activate this panel on the server.'))
		},
	}
}

export function viewsForSnapshot(snapshot: ServerWorkspaceSnapshot | null): readonly ServerWorkspaceView[] { return snapshot?.viewOrder.map((id) => snapshot.views[id]).filter((view): view is ServerWorkspaceView => view !== undefined) ?? [] }
export function projectsForView(snapshot: ServerWorkspaceSnapshot | null, view: ServerWorkspaceView | undefined): readonly ServerWorkspaceProject[] { return view === undefined ? [] : view.projectIds.map((id) => snapshot?.projects[id]).filter((project): project is ServerWorkspaceProject => project !== undefined) }
function selectView(snapshot: ServerWorkspaceSnapshot | null, selectedId: string | null): ServerWorkspaceView | undefined { const views = viewsForSnapshot(snapshot); return views.find((view) => view.id === selectedId) ?? views[0] }
function selectProject(snapshot: ServerWorkspaceSnapshot | null, view: ServerWorkspaceView | undefined, selectedId: string | null): ServerWorkspaceProject | undefined { const projects = projectsForView(snapshot, view); return projects.find((project) => project.id === selectedId) ?? projects.find((project) => project.id === view?.activeProjectId) ?? projects[0] }
function selectPanel(snapshot: ServerWorkspaceSnapshot | null, project: ServerWorkspaceProject | undefined, selectedId: string | null): ServerWorkspacePanel | undefined { if (snapshot === null || project === undefined) return undefined; return project.panelIds.map((id) => snapshot.panels[id]).find((panel) => panel?.id === selectedId) ?? snapshot.panels[project.activePanelId ?? ''] ?? project.panelIds.map((id) => snapshot.panels[id]).find((panel) => panel !== undefined) }
