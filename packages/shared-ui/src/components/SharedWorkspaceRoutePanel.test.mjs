import assert from 'node:assert/strict'
import test from 'node:test'
import { createActivityIndicatorPanel } from './ActivityIndicatorPanel.mjs'
import { createActivityNotificationPanel } from './ActivityNotificationPanel.mjs'
import { createAgentStatusPanel } from './AgentStatusPanel.mjs'
import { createAiTabMetadataPanel } from './AiTabMetadataPanel.mjs'
import { createConnectionFormPanel } from './ConnectionFormPanel.mjs'
import { createConnectionErrorPanel } from './ConnectionErrorPanel.mjs'
import { createConnectionSwitcherPanel } from './ConnectionSwitcherPanel.mjs'
import { createDictationCapturePanel } from './DictationCapturePanel.mjs'
import { createFileViewerPanel } from './FileViewerPanel.mjs'
import { createFolderBrowserPanel } from './FolderBrowserPanel.mjs'
import { createCommandSurfacePanel } from './CommandSurfacePanel.mjs'
import { createGitStatusPanel } from './GitStatusPanel.mjs'
import { createMacroEditorRoutePanel } from './MacroEditorRoutePanel.mjs'
import { createMacroLibraryPanel } from './MacroLibraryPanel.mjs'
import { createQuickPushReviewPanel } from './QuickPushReviewPanel.mjs'
import { createRecordingDetailRoutePanel } from './RecordingDetailRoutePanel.mjs'
import { createRecordingsLibraryPanel } from './RecordingsLibraryPanel.mjs'
import { createSettingsPanel } from './SettingsPanel.mjs'
import { MAX_SHARED_ROUTE_PANELS, createCompleteSharedWorkspaceRoutePanel, createSharedWorkspaceRoutePanel } from './SharedWorkspaceRoutePanel.mjs'
import { createTerminalSessionPanel } from './TerminalSessionPanel.mjs'
import { createWorkspaceTabStripPanel } from './WorkspaceTabStripPanel.mjs'
import { createWorkspaceViewNavigatorPanel } from './WorkspaceViewNavigatorPanel.mjs'
import { createDockviewPanelNavigatorPanel } from './DockviewPanelNavigatorPanel.mjs'
import { createWorkspaceEmptyStatePanel } from './WorkspaceEmptyStatePanel.mjs'

test('shared workspace route panel composes renderer-neutral feature panels for wide and narrow routes', () => {
  const terminal = createTerminalSessionPanel({ terminalId: 'terminal:build', label: 'Build', status: 'attached', layout: 'wide' })
  const workspace = createSharedWorkspaceRoutePanel({
    route: 'workspace',
    layout: 'wide',
    panels: [{ id: 'terminal-session', panel: terminal }],
  })
  const connection = createSharedWorkspaceRoutePanel({
    route: 'connections',
    layout: 'narrow',
    panels: [{ id: 'connection-form', panel: createConnectionFormPanel({ serverUrl: 'http://localhost:4317', status: 'idle', layout: 'narrow' }) }],
  })

  assert.equal(workspace.role, 'region')
  assert.equal(workspace.ariaLabel, 'Workspace route')
  assert.deepEqual(workspace.components[0].panel, terminal)
  assert.equal(connection.ariaLabel, 'Connections route')
  assert.equal(connection.components[0].panel.layout, 'narrow')
})

test('shared workspace route panel only accepts feature panels assigned to that registered route', () => {
  const file = createFileViewerPanel({ fileId: 'file:readme', label: 'README.md', status: 'ready', layout: 'wide' })
  const git = createGitStatusPanel({ projectId: 'project:app', label: 'App', branch: 'main', status: 'clean', layout: 'wide' })

  const fileRoute = createSharedWorkspaceRoutePanel({ route: 'file', layout: 'wide', panels: [{ id: 'file-viewer', panel: file }] })
  assert.deepEqual(fileRoute.components[0].panel, file)
  assert.throws(
    () => createSharedWorkspaceRoutePanel({ route: 'file', layout: 'wide', panels: [{ id: 'git-status', panel: git }] }),
    /not valid for the file route/u,
  )
})

test('shared workspace route panel enforces one responsive layout and canonical feature order', () => {
  const form = createConnectionFormPanel({ serverUrl: 'http://localhost:4317', status: 'idle', layout: 'narrow' })
  const terminal = createTerminalSessionPanel({ terminalId: 'terminal:build', label: 'Build', status: 'attached', layout: 'narrow' })
  const file = createFileViewerPanel({ fileId: 'file:readme', label: 'README.md', status: 'ready', layout: 'narrow' })

  const workspace = createSharedWorkspaceRoutePanel({
    route: 'workspace',
    layout: 'narrow',
    panels: [
      { id: 'file-viewer', panel: file },
      { id: 'terminal-session', panel: terminal },
    ],
  })
  assert.deepEqual(workspace.components.map(component => component.id), ['terminal-session', 'file-viewer'])

  assert.throws(
    () => createSharedWorkspaceRoutePanel({ route: 'connections', layout: 'wide', panels: [{ id: 'connection-form', panel: form }] }),
    /route layout/u,
  )
})

test('shared workspace route panel composes activity and AI panels in their canonical shared order', () => {
  const activity = createActivityIndicatorPanel({
    layout: 'wide',
    indicators: [{ tabId: 'tab:build', projectId: 'project:app', label: 'Build', kind: 'working', unread: true }],
  })
  const notifications = createActivityNotificationPanel({
    layout: 'wide',
    notifications: [{ id: 'activity:build', projectId: 'project:app', sessionId: 'terminal:build', label: 'Build needs input', kind: 'needs-input', acknowledged: false }],
  })
  const metadata = createAiTabMetadataPanel({
    tabId: 'tab:build',
    tabLabel: 'Build',
    status: 'ready',
    layout: 'wide',
    metadata: { title: 'Build terminal', icon: 'Terminal', colour: '#336699' },
  })

  const workspace = createSharedWorkspaceRoutePanel({
    route: 'workspace',
    layout: 'wide',
    panels: [
      { id: 'ai-tab-metadata', panel: metadata },
      { id: 'activity-notifications', panel: notifications },
      { id: 'activity-indicator', panel: activity },
    ],
  })

  assert.deepEqual(workspace.components.map(component => component.id), [
    'activity-indicator',
    'activity-notifications',
    'ai-tab-metadata',
  ])
})

test('complete workspace route requires and canonicalizes every shared workspace feature panel', () => {
  const layout = 'wide'
  const tabs = createWorkspaceTabStripPanel({ projectId: 'project:app', layout, selectedTabId: 'terminal:build', tabs: [{ id: 'terminal:build', kind: 'terminal', label: 'Build' }] })
  const views = createWorkspaceViewNavigatorPanel({ layout, activeProjectId: 'project:app', activeViewId: 'view:main', projects: [{ id: 'project:app', label: 'App' }], views: [{ id: 'view:main', label: 'Main' }] })
  const dockview = createDockviewPanelNavigatorPanel({ projectId: 'project:app', layout, selectedPanelId: 'panel:build', panels: [{ id: 'panel:build', label: 'Build' }] })
  const activity = createActivityIndicatorPanel({ layout, indicators: [] })
  const notifications = createActivityNotificationPanel({ layout, notifications: [] })
  const terminal = createTerminalSessionPanel({ terminalId: 'terminal:build', label: 'Build', status: 'attached', layout })
  const file = createFileViewerPanel({ fileId: 'file:readme', label: 'README.md', status: 'ready', layout })
  const folder = createFolderBrowserPanel({ folderId: 'folder:root', label: 'Root', status: 'ready', layout, entries: [] })
  const agents = createAgentStatusPanel({ layout, agents: [] })
  const metadata = createAiTabMetadataPanel({ tabId: 'terminal:build', tabLabel: 'Build', status: 'ready', layout, metadata: { title: 'Build', icon: 'Terminal', colour: '#336699' } })
  const commands = createCommandSurfacePanel({ layout, status: 'ready', commands: [] })
  const empty = createWorkspaceEmptyStatePanel({ serverId: 'server:local', status: 'no-panels', projectId: 'project:app', layout })
  const entries = [
    ['workspace-empty', empty], ['command-surface', commands], ['ai-tab-metadata', metadata], ['agent-status', agents], ['folder-browser', folder], ['file-viewer', file], ['terminal-session', terminal], ['activity-notifications', notifications], ['activity-indicator', activity], ['dockview-navigation', dockview], ['workspace-views', views], ['workspace-tabs', tabs],
  ].map(([id, panel]) => ({ id, panel }))

  const workspace = createCompleteSharedWorkspaceRoutePanel({ route: 'workspace', layout, panels: entries })
  assert.deepEqual(workspace.components.map(component => component.id), [
    'workspace-tabs', 'workspace-views', 'dockview-navigation', 'activity-indicator', 'activity-notifications', 'terminal-session', 'file-viewer', 'folder-browser', 'agent-status', 'ai-tab-metadata', 'command-surface', 'workspace-empty',
  ])
  assert.throws(
    () => createCompleteSharedWorkspaceRoutePanel({ route: 'workspace', layout, panels: entries.slice(1) }),
    /requires every registered feature panel/u,
  )
})

test('complete workspace route preserves the real shared workspace failure alert', () => {
  const layout = 'narrow'
  const empty = createWorkspaceEmptyStatePanel({
    serverId: 'server:remote',
    status: 'failed',
    layout,
  })

  const route = createSharedWorkspaceRoutePanel({
    route: 'workspace',
    layout,
    panels: [{ id: 'workspace-empty', panel: empty }],
  })

  assert.deepEqual(route.components[0].panel, empty)
  assert.equal(route.components[0].panel.role, 'alert')
  assert.equal(route.components[0].panel.ariaLive, 'assertive')
  assert.throws(
    () => createSharedWorkspaceRoutePanel({
      route: 'connections',
      layout,
      panels: [{ id: 'connection-form', panel: empty }],
    }),
    /connections alert/u,
  )
})

test('complete shared ready routes require every registered panel outside the workspace route', () => {
  const layout = 'wide'
  const panel = (route, id) => ({
    role: route === 'connections' && id === 'connection-error'
      ? 'alert'
      : route === 'settings' && id === 'dictation-capture'
        ? 'dialog'
        : 'region',
    ariaLabel: `${route} ${id}`,
    layout,
  })
  const routePanels = {
    connections: ['connection-form', 'connection-switcher', 'connection-error'],
    settings: ['settings', 'dictation-capture'],
    recordings: ['recordings-library', 'recording-detail'],
    macros: ['macro-library', 'macro-editor'],
    file: ['file-viewer', 'folder-browser'],
    git: ['git-status', 'quick-push-review'],
  }

  for (const [route, ids] of Object.entries(routePanels)) {
    const panels = ids.map(id => ({ id, panel: panel(route, id) }))
    const complete = createCompleteSharedWorkspaceRoutePanel({ route, layout, panels: [...panels].reverse() })
    assert.deepEqual(complete.components.map(component => component.id), ids, `${route} keeps canonical panel order`)
    assert.throws(
      () => createCompleteSharedWorkspaceRoutePanel({ route, layout, panels: panels.slice(1) }),
      /requires every registered feature panel/u,
      `${route} rejects a partial ready route`,
    )
  }
})

test('shared workspace route panel composes the complete connections route and permits its registered alert only', () => {
  const form = createConnectionFormPanel({ serverUrl: 'http://localhost:4317', status: 'idle', layout: 'narrow' })
  const switcher = createConnectionSwitcherPanel({
    layout: 'narrow',
    status: 'ready',
    activeConnectionId: 'server:local',
    connections: [{
      id: 'server:local',
      label: 'Local server',
      origin: 'http://localhost:4317',
      status: 'connected',
    }],
  })
  const error = createConnectionErrorPanel({ status: 'offline', serverLabel: 'Local server', layout: 'narrow' })

  const connections = createSharedWorkspaceRoutePanel({
    route: 'connections',
    layout: 'narrow',
    panels: [
      { id: 'connection-error', panel: error },
      { id: 'connection-switcher', panel: switcher },
      { id: 'connection-form', panel: form },
    ],
  })

  assert.deepEqual(connections.components.map(component => component.id), [
    'connection-form', 'connection-switcher', 'connection-error',
  ])
  assert.equal(connections.components[2].panel.role, 'alert')
  assert.throws(
    () => createSharedWorkspaceRoutePanel({
      route: 'workspace',
      layout: 'narrow',
      panels: [{ id: 'terminal-session', panel: error }],
    }),
    /connections alert/u,
  )
})

test('shared workspace route panel composes tab, project/view, and Dockview navigation contracts', () => {
  const tabs = createWorkspaceTabStripPanel({
    projectId: 'project:app', layout: 'narrow', selectedTabId: 'terminal:build',
    tabs: [{ id: 'terminal:build', kind: 'terminal', label: 'Build' }],
  })
  const views = createWorkspaceViewNavigatorPanel({
    layout: 'narrow', activeProjectId: 'project:app', activeViewId: 'view:main',
    projects: [{ id: 'project:app', label: 'App' }],
    views: [{ id: 'view:main', label: 'Main' }],
  })
  const dockview = createDockviewPanelNavigatorPanel({
    projectId: 'project:app', layout: 'narrow', selectedPanelId: 'panel:build',
    panels: [{ id: 'panel:build', label: 'Build' }],
  })

  const workspace = createSharedWorkspaceRoutePanel({
    route: 'workspace', layout: 'narrow', panels: [
      { id: 'dockview-navigation', panel: dockview },
      { id: 'workspace-views', panel: views },
      { id: 'workspace-tabs', panel: tabs },
    ],
  })

  assert.deepEqual(workspace.components.map(component => component.id), [
    'workspace-tabs', 'workspace-views', 'dockview-navigation',
  ])
  assert.equal(workspace.components[1].panel.role, 'navigation')
  assert.throws(
    () => createSharedWorkspaceRoutePanel({
      route: 'workspace', layout: 'narrow',
      panels: [{ id: 'workspace-views', panel: { ...views, role: 'dialog' } }],
    }),
    /workspace navigation/u,
  )
})

test('shared workspace route panel composes the real settings and dictation contracts in canonical order', () => {
  const settings = createSettingsPanel({
    layout: 'narrow',
    status: 'ready',
    sections: [{ id: 'appearance', label: 'Appearance' }],
    selectedSectionId: 'appearance',
  })
  const dictation = createDictationCapturePanel({
    layout: 'narrow',
    requestId: 'dictation:1',
    status: 'recording',
    destinationDisclosure: 'Transcription is sent to this Terminay server.',
    target: {
      serverId: 'server:local',
      projectId: 'project:app',
      panelId: 'panel:terminal',
      sessionId: 'terminal:build',
      terminalLabel: 'Build',
    },
  })

  const route = createSharedWorkspaceRoutePanel({
    route: 'settings',
    layout: 'narrow',
    panels: [
      { id: 'dictation-capture', panel: dictation },
      { id: 'settings', panel: settings },
    ],
  })

  assert.deepEqual(route.components.map(component => component.id), [
    'settings',
    'dictation-capture',
  ])
  assert.equal(route.components[1].panel.role, 'dialog')
  assert.throws(
    () => createSharedWorkspaceRoutePanel({ route: 'workspace', layout: 'narrow', panels: [{ id: 'terminal-session', panel: dictation }] }),
    /except the settings dictation dialog/u,
  )
})

test('shared workspace route panel composes macros, recordings, and Git contracts in canonical route order', () => {
  const macroLibrary = createMacroLibraryPanel({
    layout: 'wide',
    status: 'ready',
    macros: [{ id: 'macro:build', label: 'Build' }],
    selectedMacroId: 'macro:build',
  })
  const macroEditor = createMacroEditorRoutePanel({
    layout: 'wide',
    status: 'ready',
    projectId: 'project:app',
    macroId: 'macro:build',
    draft: { label: 'Build', body: 'npm run build' },
  })
  const macros = createSharedWorkspaceRoutePanel({
    route: 'macros', layout: 'wide', panels: [
      { id: 'macro-editor', panel: macroEditor },
      { id: 'macro-library', panel: macroLibrary },
    ],
  })
  assert.deepEqual(macros.components.map(component => component.id), ['macro-library', 'macro-editor'])

  const recordingsLibrary = createRecordingsLibraryPanel({
    layout: 'narrow',
    status: 'ready',
    recordings: [{ id: 'recording:build', title: 'Build output' }],
    selectedRecordingId: 'recording:build',
  })
  const recordingDetail = createRecordingDetailRoutePanel({
    layout: 'narrow',
    status: 'ready',
    projectId: 'project:app',
    recording: { id: 'recording:build', title: 'Build output' },
  })
  const recordings = createSharedWorkspaceRoutePanel({
    route: 'recordings', layout: 'narrow', panels: [
      { id: 'recording-detail', panel: recordingDetail },
      { id: 'recordings-library', panel: recordingsLibrary },
    ],
  })
  assert.deepEqual(recordings.components.map(component => component.id), ['recordings-library', 'recording-detail'])

  const gitStatus = createGitStatusPanel({
    layout: 'wide', projectId: 'project:app', label: 'App', branch: 'main', status: 'changes',
  })
  const quickPush = createQuickPushReviewPanel({
    layout: 'wide', projectId: 'project:app', projectLabel: 'App', branch: 'main', status: 'ready',
    commits: [{ hash: 'abcdef1', summary: 'Ship the shared route' }],
  })
  const git = createSharedWorkspaceRoutePanel({
    route: 'git', layout: 'wide', panels: [
      { id: 'quick-push-review', panel: quickPush },
      { id: 'git-status', panel: gitStatus },
    ],
  })
  assert.deepEqual(git.components.map(component => component.id), ['git-status', 'quick-push-review'])
})

test('shared workspace route panel fails closed for malformed, duplicate, and unbounded route state', () => {
  const terminal = createTerminalSessionPanel({ terminalId: 'terminal:build', label: 'Build', status: 'attached', layout: 'wide' })
  assert.throws(() => createSharedWorkspaceRoutePanel({ route: 'unknown', layout: 'wide', panels: [{ id: 'terminal-session', panel: terminal }] }), /registered/u)
  assert.throws(() => createSharedWorkspaceRoutePanel({ route: 'workspace', layout: 'tablet', panels: [{ id: 'terminal-session', panel: terminal }] }), /layout/u)
  assert.throws(() => createSharedWorkspaceRoutePanel({ route: 'workspace', layout: 'wide', panels: [] }), /require one/u)
  assert.throws(() => createSharedWorkspaceRoutePanel({ route: 'workspace', layout: 'wide', panels: [{ id: 'terminal-session', panel: terminal }, { id: 'terminal-session', panel: terminal }] }), /unique/u)
  assert.throws(() => createSharedWorkspaceRoutePanel({ route: 'workspace', layout: 'wide', panels: Array.from({ length: MAX_SHARED_ROUTE_PANELS + 1 }, () => ({ id: 'terminal-session', panel: terminal })) }), /one to/u)
  assert.throws(() => createSharedWorkspaceRoutePanel({ route: 'workspace', layout: 'wide', panels: [{ id: 'terminal-session', panel: { role: 'region', ariaLabel: 'Bad\nlabel' } }] }), /safe aria label/u)
})

test('shared workspace route panel snapshots immutable data-only panel models at composition', () => {
  const panel = {
    role: 'region',
    ariaLabel: 'Terminal Build',
    layout: 'wide',
    nested: { label: 'Initial' },
  }
  const route = createSharedWorkspaceRoutePanel({
    route: 'workspace',
    layout: 'wide',
    panels: [{ id: 'terminal-session', panel }],
  })

  panel.ariaLabel = 'Mutated by host'
  panel.nested.label = 'Mutated by host'
  assert.equal(route.components[0].panel.ariaLabel, 'Terminal Build')
  assert.equal(route.components[0].panel.nested.label, 'Initial')
  assert.equal(Object.isFrozen(route.components[0].panel), true)
  assert.equal(Object.isFrozen(route.components[0].panel.nested), true)
  assert.throws(
    () => createSharedWorkspaceRoutePanel({
      route: 'workspace',
      layout: 'wide',
      panels: [{ id: 'terminal-session', panel: { role: 'region', ariaLabel: 'Terminal', layout: 'wide', invoke: () => {} } }],
    }),
    /data only/u,
  )
  assert.throws(
    () => createSharedWorkspaceRoutePanel({
      route: 'workspace',
      layout: 'wide',
      panels: [{ id: 'terminal-session', panel: { role: 'region', ariaLabel: 'Terminal', layout: 'wide', get hostValue() { return 'unsafe' } } }],
    }),
    /accessors/u,
  )
})
