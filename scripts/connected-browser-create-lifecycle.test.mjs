import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { TerminayTerminalClient, WorkspaceClient } from '../packages/client-core/dist/index.js'

function commandResult(result = {}) {
  return { commandId: 'test-command', ok: true, result }
}

test('connected browser project and terminal plus use one canonical server identity across refresh', async () => {
  const commands = []
  const writes = []
  const state = {
    schemaVersion: 1,
    serverId: 'browser-server',
    revision: 1,
    cursor: '1',
    viewOrder: ['view-a'],
    views: {
      'view-a': {
        id: 'view-a',
        serverId: 'browser-server',
        name: 'Workspace',
        projectIds: ['project-a'],
        activeProjectId: 'project-a',
      },
    },
    projects: {
      'project-a': {
        id: 'project-a',
        serverId: 'browser-server',
        viewId: 'view-a',
        root: '/srv/workspace',
        name: 'Project A',
        panelIds: [],
        layout: { kind: 'stack', panelIds: [] },
      },
    },
    panels: {},
    terminalSessions: {},
  }

  const applicationTransport = {
    async command(operation, payload) {
      commands.push([operation, payload])
      if (operation === 'workspace.command') {
        const project = payload.command
        assert.equal(project.type, 'project.create')
        state.projects[project.projectId] = {
          id: project.projectId,
          serverId: state.serverId,
          viewId: project.viewId,
          root: project.root,
          name: project.name,
          panelIds: [],
          layout: { kind: 'stack', panelIds: [] },
        }
        state.views[project.viewId].projectIds.push(project.projectId)
        state.views[project.viewId].activeProjectId = project.projectId
        state.revision += 1
        state.cursor = String(state.revision)
        return commandResult({})
      }
      if (operation === 'terminal.create') {
        const sessionId = 'session-server-owned'
        const panelId = 'panel-server-owned'
        state.terminalSessions[sessionId] = {
          id: sessionId,
          serverId: state.serverId,
          projectId: payload.projectId,
          status: 'running',
          createdAt: 1,
          outputPosition: 0,
        }
        state.panels[panelId] = {
          id: panelId,
          projectId: payload.projectId,
          type: 'terminal',
          sessionId,
          cwd: payload.cwd,
          createdAt: 1,
        }
        state.projects[payload.projectId].panelIds.push(panelId)
        state.projects[payload.projectId].activePanelId = panelId
        state.revision += 1
        state.cursor = String(state.revision)
        return commandResult({
          serverId: state.serverId,
          projectId: payload.projectId,
          sessionId,
          cwd: payload.cwd,
          status: 'running',
          createdAt: 1,
          outputPosition: 0,
          replayFrom: 0,
          dimensions: { cols: 80, rows: 24 },
        })
      }
      if (operation === 'terminal.attach') {
        return commandResult({
          attachmentId: 'attachment-a',
          fromPosition: 0,
          position: 0,
          replayFrom: 0,
          events: [],
        })
      }
      if (operation === 'terminal.input') {
        writes.push(payload)
        return commandResult({})
      }
      if (operation === 'terminal.detach') return commandResult({})
      throw new Error(`unexpected command ${operation}`)
    },
    async query(operation, payload) {
      assert.match(operation, /^workspace\.(?:snapshot|delta)$/u)
      return {
        result: operation === 'workspace.delta'
          ? {
              deltaVersion: 1,
              serverId: state.serverId,
              fromRevision: payload.revision,
              fromCursor: payload.cursor,
              revision: state.revision,
              cursor: state.cursor,
              state,
              events: [],
            }
          : state,
      }
    },
    async subscribe() {
      return {
        onEvent: () => () => {},
        onResync: () => () => {},
        unsubscribe: async () => {},
      }
    },
  }

  const workspace = new WorkspaceClient(applicationTransport)
  await workspace.createProject({
    projectId: 'project-browser-created',
    viewId: 'view-a',
    root: state.projects['project-a'].root,
    name: 'Project 2',
  })
  const afterProject = (await workspace.snapshot())
  assert.deepEqual(afterProject.views['view-a'].projectIds, [
    'project-a',
    'project-browser-created',
  ])
  assert.equal(afterProject.projects['project-browser-created'].root, '/srv/workspace')

  const terminal = new TerminayTerminalClient(applicationTransport)
  const created = await terminal.create({
    projectId: 'project-browser-created',
    cwd: afterProject.projects['project-browser-created'].root,
  })
  const attachment = await terminal.attach({
    clientId: 'browser-client',
    serverId: created.serverId,
    projectId: created.projectId,
    sessionId: created.sessionId,
    fromPosition: 0,
  })
  await attachment.write('printf canonical\\r')

  const refreshed = await workspace.delta(0, '0')
  assert.deepEqual(refreshed.state.views['view-a'].projectIds, [
    'project-a',
    'project-browser-created',
  ])
  assert.equal(Object.keys(refreshed.state.terminalSessions).length, 1)
  assert.equal(Object.keys(refreshed.state.panels).length, 1)
  assert.equal(refreshed.state.projects['project-browser-created'].panelIds.length, 1)
  assert.equal(writes.length, 1)
  assert.equal(
    Buffer.from(writes[0].dataBase64, 'base64').toString(),
    'printf canonical\\r',
  )

  assert.equal(
    commands.filter(([, payload]) => payload?.command?.type === 'project.create').length,
    1,
  )
  assert.equal(commands.filter(([operation]) => operation === 'terminal.create').length, 1)
})

test('connected browser reconnect preserves server projects, panels, active panel, and terminal sessions', async () => {
  const state = {
    schemaVersion: 1,
    serverId: 'browser-server',
    revision: 4,
    cursor: '4',
    viewOrder: ['view-a'],
    views: {
      'view-a': {
        id: 'view-a',
        serverId: 'browser-server',
        name: 'Workspace',
        projectIds: ['project-a', 'project-b'],
        activeProjectId: 'project-b',
      },
    },
    projects: {
      'project-a': {
        id: 'project-a',
        serverId: 'browser-server',
        viewId: 'view-a',
        root: '/srv/a',
        name: 'Project',
        panelIds: ['panel-a'],
        activePanelId: 'panel-a',
        layout: { kind: 'stack', panelIds: ['panel-a'], activePanelId: 'panel-a' },
      },
      'project-b': {
        id: 'project-b',
        serverId: 'browser-server',
        viewId: 'view-a',
        root: '/srv/b',
        name: 'Project 2',
        panelIds: ['panel-b'],
        activePanelId: 'panel-b',
        layout: { kind: 'stack', panelIds: ['panel-b'], activePanelId: 'panel-b' },
      },
    },
    panels: {
      'panel-a': {
        id: 'panel-a',
        projectId: 'project-a',
        type: 'terminal',
        sessionId: 'session-a',
        title: 'Terminal 1',
        createdAt: 1,
      },
      'panel-b': {
        id: 'panel-b',
        projectId: 'project-b',
        type: 'terminal',
        sessionId: 'session-b',
        title: 'Terminal 2',
        createdAt: 2,
      },
    },
    terminalSessions: {
      'session-a': {
        id: 'session-a',
        serverId: 'browser-server',
        projectId: 'project-a',
        status: 'running',
        createdAt: 1,
        outputPosition: 7,
      },
      'session-b': {
        id: 'session-b',
        serverId: 'browser-server',
        projectId: 'project-b',
        status: 'running',
        createdAt: 2,
        outputPosition: 11,
      },
    },
  }
  const snapshots = []
  const transport = {
    async command(operation) {
      if (operation === 'terminal.attach') {
        return commandResult({
          attachmentId: 'attachment-reconnect',
          events: [],
          fromPosition: 0,
          position: 0,
          replayFrom: 0,
        })
      }
      if (operation === 'terminal.detach') return commandResult({})
      throw new Error(`unexpected command ${operation}`)
    },
    async query(operation, payload) {
      assert.match(operation, /^workspace\.(?:snapshot|delta)$/u)
      snapshots.push(operation)
      return {
        result: operation === 'workspace.delta'
          ? {
              deltaVersion: 1,
              serverId: state.serverId,
              fromRevision: payload.revision,
              fromCursor: payload.cursor,
              revision: state.revision,
              cursor: state.cursor,
              state,
              events: [],
            }
          : state,
      }
    },
    async subscribe() {
      return {
        onEvent: () => () => {},
        onResync: () => () => {},
        unsubscribe: async () => {},
      }
    },
  }

  const first = await new WorkspaceClient(transport).snapshot()
  const afterReconnect = await new WorkspaceClient(transport).snapshot()

  assert.deepEqual(Object.keys(afterReconnect.projects).sort(), ['project-a', 'project-b'])
  assert.equal(afterReconnect.views['view-a'].activeProjectId, 'project-b')
  assert.deepEqual(afterReconnect.projects['project-b'].panelIds, ['panel-b'])
  assert.equal(afterReconnect.projects['project-b'].activePanelId, 'panel-b')
  assert.equal(afterReconnect.panels['panel-b'].sessionId, 'session-b')
  assert.deepEqual(Object.keys(afterReconnect.terminalSessions).sort(), ['session-a', 'session-b'])
  assert.equal(Object.values(afterReconnect.projects).filter((project) => project.name === 'Project').length, 1)
  assert.deepEqual(first, afterReconnect)
  assert.deepEqual(snapshots, ['workspace.snapshot', 'workspace.snapshot'])
})

test('an explicit empty server repository stays empty until an explicit user command', async () => {
  const commands = []
  const state = {
    schemaVersion: 1,
    serverId: 'browser-server',
    revision: 0,
    cursor: '0',
    viewOrder: [],
    views: {},
    projects: {},
    panels: {},
    terminalSessions: {},
  }
  const transport = {
    async command(operation, payload) {
      commands.push([operation, payload])
      throw new Error(`unexpected command ${operation}`)
    },
    async query() {
      return { result: state }
    },
    async subscribe() {
      return {
        onEvent: () => () => {},
        onResync: () => () => {},
        unsubscribe: async () => {},
      }
    },
  }

  const workspace = new WorkspaceClient(transport)
  assert.deepEqual(await workspace.snapshot(), state)
  assert.deepEqual(await workspace.snapshot(), state)
  assert.deepEqual(commands, [])
})

test('connected App plus paths do not synthesize project or terminal presentation', async () => {
  const [collection, creation, app] = await Promise.all([
    readFile('src/workspace/useProjectCollection.ts', 'utf8'),
    readFile('src/workspace/useTerminalCreationController.ts', 'utf8'),
    readFile('src/App.tsx', 'utf8'),
  ])
  assert.match(collection, /workspaceSnapshotStore\s*\n\s*\.createProject/u)
  assert.match(collection, /root: serverRoot/u)
  assert.match(creation, /terminalPanelClientContext\.client\.create|createSession/u)
  assert.match(creation, /panelId: presented\.panelId/u)
  assert.doesNotMatch(creation, /panelId: `pending:\$\{sessionId\}`/u)
  assert.match(creation, /workspace\.changed is the sole owner of Dockview presentation/u)
  assert.match(creation, /terminay-focus-terminal/u)
  assert.doesNotMatch(creation, /apiRef\.current\?\.addPanel|apiRef\.current\.addPanel/u)
  assert.match(app, /terminalPanelClientContext\.client\.create\(request\)/u)
  const openTerminalAt = app.slice(
    app.indexOf('const handleOpenTerminalAt = useCallback'),
    app.indexOf('const handleOpenTerminalAtWorktree', app.indexOf('const handleOpenTerminalAt = useCallback')),
  )
  assert.match(openTerminalAt, /terminalPanelClientContext\.client\.create\(\{\s*cwd,\s*projectId: project\.id,\s*\}\)/u)
  assert.match(openTerminalAt, /workspaceSnapshotStore\?\.waitForSnapshot\(/u)
  assert.match(openTerminalAt, /getPanelForSession\(sessionId\)/u)
  assert.doesNotMatch(openTerminalAt, /api\.addPanel<TerminalPanelParams>/u)
  assert.doesNotMatch(app, /initialTerminalSeed(?:ed|Started|Promise|Attempt)/u)
  assert.doesNotMatch(app, /app\.workspace\.seed\./u)
  assert.doesNotMatch(app, /setTimeout\(\(\) => resolve\(addTerminal\(\{\}\)\)/u)
  assert.match(app, /for \(const session of Object\.values\(snapshot\.terminalSessions\)\)/u)
  assert.match(app, /workspace\.acceptServerTerminal\(\s*panel\.id,\s*session\.id,\s*panel\.title,\s*panel\.cwd,\s*\)/u)
})
