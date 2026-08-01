import { Component, type ErrorInfo, type ReactNode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createConnectionErrorPanel } from '../../packages/shared-ui/src/components/ConnectionErrorPanel.mjs'
import { createConnectionFormPanel } from '../../packages/shared-ui/src/components/ConnectionFormPanel.mjs'
import { createConnectionSwitcherPanel } from '../../packages/shared-ui/src/components/ConnectionSwitcherPanel.mjs'
import { createDictationCapturePanel } from '../../packages/shared-ui/src/components/DictationCapturePanel.mjs'
import { createMcpServerControlPanel } from '../../packages/shared-ui/src/components/McpServerControlPanel.mjs'
import { createMacroEditorRoutePanel } from '../../packages/shared-ui/src/components/MacroEditorRoutePanel.mjs'
import { createMacroLibraryPanel } from '../../packages/shared-ui/src/components/MacroLibraryPanel.mjs'
import { createQuickPushReviewPanel } from '../../packages/shared-ui/src/components/QuickPushReviewPanel.mjs'
import { createRecordingDetailRoutePanel } from '../../packages/shared-ui/src/components/RecordingDetailRoutePanel.mjs'
import { createRecordingsLibraryPanel } from '../../packages/shared-ui/src/components/RecordingsLibraryPanel.mjs'
import { createSettingsPanel } from '../../packages/shared-ui/src/components/SettingsPanel.mjs'
import { createActivityIndicatorPanel } from '../../packages/shared-ui/src/components/ActivityIndicatorPanel.mjs'
import { createActivityNotificationPanel } from '../../packages/shared-ui/src/components/ActivityNotificationPanel.mjs'
import { createAgentStatusPanel } from '../../packages/shared-ui/src/components/AgentStatusPanel.mjs'
import { createAiTabMetadataPanel } from '../../packages/shared-ui/src/components/AiTabMetadataPanel.mjs'
import { createCommandSurfacePanel } from '../../packages/shared-ui/src/components/CommandSurfacePanel.mjs'
import { createDockviewPanelNavigatorPanel } from '../../packages/shared-ui/src/components/DockviewPanelNavigatorPanel.mjs'
import { createFileViewerPanel } from '../../packages/shared-ui/src/components/FileViewerPanel.mjs'
import { createFolderBrowserPanel } from '../../packages/shared-ui/src/components/FolderBrowserPanel.mjs'
import { createGitStatusPanel } from '../../packages/shared-ui/src/components/GitStatusPanel.mjs'
import { createTerminalSessionPanel } from '../../packages/shared-ui/src/components/TerminalSessionPanel.mjs'
import { createWorkspaceEmptyStatePanel } from '../../packages/shared-ui/src/components/WorkspaceEmptyStatePanel.mjs'
import { createWorkspaceTabStripPanel } from '../../packages/shared-ui/src/components/WorkspaceTabStripPanel.mjs'
import { createWorkspaceViewNavigatorPanel } from '../../packages/shared-ui/src/components/WorkspaceViewNavigatorPanel.mjs'
import { createCompleteSharedWorkspaceRoutePanel } from '../../packages/shared-ui/src/components/SharedWorkspaceRoutePanel.mjs'
import { SharedWorkspaceRouteSurface } from '../../src/shared/SharedWorkspaceRouteSurface'

class RouteBoundary extends Component<{ readonly children: ReactNode }, { readonly error: Error | null }> {
	state = { error: null as Error | null }
	static getDerivedStateFromError(error: Error) { return { error } }
	componentDidCatch(_error: Error, _info: ErrorInfo) {}
	render() {
		return this.state.error === null
			? this.props.children
			: <output data-shared-route-rejection>{this.state.error.message}</output>
	}
}

function Fixture() {
	const layout = window.innerWidth <= 720 ? 'narrow' : window.innerWidth < 1100 ? 'medium' : 'wide'
	const panelLayout = layout === 'medium' ? 'wide' : layout
	const routeLayoutModel = <T extends { readonly layout: 'wide' | 'narrow'; readonly components: readonly unknown[] }>(model: T) => layout === 'medium'
		? Object.freeze({ ...model, layout: 'medium' as const, components: Object.freeze([...model.components]) })
		: model
	const [intent, setIntent] = useState('')
	const connectionModel = routeLayoutModel(createCompleteSharedWorkspaceRoutePanel({ route: 'connections', layout: panelLayout, panels: [
		{ id: 'connection-error', panel: createConnectionErrorPanel({ layout: panelLayout, status: 'offline', serverLabel: 'Local server' }) },
		{ id: 'connection-switcher', panel: createConnectionSwitcherPanel({ layout: panelLayout, status: 'ready', activeConnectionId: 'server:local', connections: [{ id: 'server:local', label: 'Local server', origin: 'http://localhost:4317', status: 'connected' }] }) },
		{ id: 'connection-form', panel: createConnectionFormPanel({ layout: panelLayout, status: 'idle', serverUrl: 'http://localhost:4317' }) },
	] }))
	const settingsModel = routeLayoutModel(createCompleteSharedWorkspaceRoutePanel({ route: 'settings', layout: panelLayout, panels: [
		{ id: 'settings', panel: createSettingsPanel({ layout: panelLayout, status: 'ready', selectedSectionId: 'appearance', sections: [{ id: 'appearance', label: 'Appearance' }] }) },
		{ id: 'mcp-server-control', panel: createMcpServerControlPanel({ layout: panelLayout, status: 'ready', servers: [{ id: 'mcp:docs', label: 'Documentation', state: 'running' }] }) },
		{ id: 'dictation-capture', panel: createDictationCapturePanel({
			layout: panelLayout, status: 'recording', requestId: 'dictation:fixture', destinationDisclosure: 'Transcription is sent to this Terminay server.',
			target: { serverId: 'server:local', projectId: 'project:app', panelId: 'panel:terminal', sessionId: 'terminal:build', terminalLabel: 'Build' },
		}) },
	] }))
	const recordingsModel = routeLayoutModel(createCompleteSharedWorkspaceRoutePanel({ route: 'recordings', layout: panelLayout, panels: [
		{ id: 'recordings-library', panel: createRecordingsLibraryPanel({ layout: panelLayout, status: 'ready', selectedRecordingId: 'recording:build', recordings: [{ id: 'recording:build', title: 'Build output', detail: 'Successful build' }] }) },
		{ id: 'recording-detail', panel: createRecordingDetailRoutePanel({ layout: panelLayout, projectId: 'project:app', status: 'ready', recording: { id: 'recording:build', title: 'Build output', detail: 'Successful build' } }) },
	] }))
	const macrosModel = routeLayoutModel(createCompleteSharedWorkspaceRoutePanel({ route: 'macros', layout: panelLayout, panels: [
		{ id: 'macro-library', panel: createMacroLibraryPanel({ layout: panelLayout, status: 'ready', selectedMacroId: 'macro:build', macros: [{ id: 'macro:build', label: 'Build', detail: 'Run the project build' }] }) },
		{ id: 'macro-editor', panel: createMacroEditorRoutePanel({ layout: panelLayout, projectId: 'project:app', macroId: 'macro:build', status: 'ready', draft: { label: 'Build', body: 'npm run build' } }) },
	] }))
	const fileModel = routeLayoutModel(createCompleteSharedWorkspaceRoutePanel({ route: 'file', layout: panelLayout, panels: [
		{ id: 'file-viewer', panel: createFileViewerPanel({ fileId: 'file:readme', label: 'README.md', status: 'ready', layout: panelLayout }) },
		{ id: 'folder-browser', panel: createFolderBrowserPanel({ folderId: 'folder:root', label: 'Root', status: 'ready', layout: panelLayout, entries: [{ id: 'file:readme', label: 'README.md', kind: 'file' }] }) },
	] }))
	const gitModel = routeLayoutModel(createCompleteSharedWorkspaceRoutePanel({ route: 'git', layout: panelLayout, panels: [
		{ id: 'git-status', panel: createGitStatusPanel({ projectId: 'project:app', label: 'App', status: 'changes', layout: panelLayout, branch: 'main' }) },
		{ id: 'quick-push-review', panel: createQuickPushReviewPanel({ projectId: 'project:app', projectLabel: 'App', branch: 'main', status: 'ready', layout: panelLayout, commits: [{ hash: 'abcdef1', summary: 'Add shared route surface' }] }) },
	] }))
	const workspaceModel = routeLayoutModel(createCompleteSharedWorkspaceRoutePanel({ route: 'workspace', layout: panelLayout, panels: [
		{ id: 'workspace-tabs', panel: createWorkspaceTabStripPanel({ projectId: 'project:app', layout: panelLayout, selectedTabId: 'terminal:build', tabs: [{ id: 'terminal:build', kind: 'terminal', label: 'Build' }, { id: 'file:readme', kind: 'file', label: 'README.md', closable: true }] }) },
		{ id: 'workspace-views', panel: createWorkspaceViewNavigatorPanel({ layout: panelLayout, activeProjectId: 'project:app', activeViewId: 'view:main', projects: [{ id: 'project:app', label: 'App' }], views: [{ id: 'view:main', label: 'Main' }] }) },
		{ id: 'dockview-navigation', panel: createDockviewPanelNavigatorPanel({ projectId: 'project:app', layout: panelLayout, selectedPanelId: 'panel:build', panels: [{ id: 'panel:build', label: 'Build' }] }) },
		{ id: 'activity-indicator', panel: createActivityIndicatorPanel({ layout: panelLayout, indicators: [] }) },
		{ id: 'activity-notifications', panel: createActivityNotificationPanel({ layout: panelLayout, notifications: [] }) },
		{ id: 'terminal-session', panel: createTerminalSessionPanel({ terminalId: 'terminal:build', label: 'Build', status: 'failed', layout: panelLayout }) },
		{ id: 'file-viewer', panel: createFileViewerPanel({ fileId: 'file:readme', label: 'README.md', status: 'ready', layout: panelLayout }) },
		{ id: 'folder-browser', panel: createFolderBrowserPanel({ folderId: 'folder:root', label: 'Root', status: 'ready', layout: panelLayout, selectedEntryId: 'file:readme', entries: [{ id: 'folder:src', label: 'src', kind: 'folder' }, { id: 'file:readme', label: 'README.md', kind: 'file' }] }) },
		{ id: 'agent-status', panel: createAgentStatusPanel({ layout: panelLayout, agents: [] }) },
		{ id: 'ai-tab-metadata', panel: createAiTabMetadataPanel({ tabId: 'terminal:build', tabLabel: 'Build', status: 'ready', layout: panelLayout, metadata: { title: 'Build', icon: 'Terminal', colour: '#336699' } }) },
		{ id: 'command-surface', panel: createCommandSurfacePanel({ layout: panelLayout, status: 'ready', commands: [] }) },
		{ id: 'workspace-empty', panel: createWorkspaceEmptyStatePanel({ serverId: 'server:local', status: 'no-panels', projectId: 'project:app', layout: panelLayout }) },
	] }))
	const recordIntent = ({ panelId, action }: { panelId: string, action: { id: string } }) => setIntent(`${panelId}:${action.id}`)
	const isMutableProbe = new URLSearchParams(window.location.search).get('mutable') === '1'
	const renderedConnectionModel = isMutableProbe
		? { ...connectionModel, components: [...connectionModel.components] }
		: connectionModel
	return <>
		<RouteBoundary><SharedWorkspaceRouteSurface model={renderedConnectionModel} onIntent={recordIntent} /></RouteBoundary>
		<SharedWorkspaceRouteSurface model={settingsModel} onIntent={recordIntent} />
		<SharedWorkspaceRouteSurface model={recordingsModel} onIntent={recordIntent} />
		<SharedWorkspaceRouteSurface model={macrosModel} onIntent={recordIntent} />
		<SharedWorkspaceRouteSurface model={fileModel} onIntent={recordIntent} />
		<SharedWorkspaceRouteSurface model={gitModel} onIntent={recordIntent} />
		<SharedWorkspaceRouteSurface model={workspaceModel} onIntent={recordIntent} />
		<output data-shared-route-intent>{intent}</output>
	</>
}
const root = document.getElementById('shared-workspace-route-root')
if (root === null) throw new Error('Missing route fixture root')
createRoot(root).render(<Fixture />)
