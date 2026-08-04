import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const [main, preload, panel, panelClient, workspaceE2e] = await Promise.all([
  readFile(new URL('electron/main.ts', root), 'utf8'),
  readFile(new URL('electron/preload.ts', root), 'utf8'),
  readFile(new URL('src/components/TerminalPanel.tsx', root), 'utf8'),
  readFile(new URL('packages/client-core/src/terminalPanel.ts', root), 'utf8'),
  readFile(new URL('e2e/workspace.spec.ts', root), 'utf8'),
])

const app = await readFile(new URL('src/App.tsx', root), 'utf8')
const dockviewLifecycle = await readFile(
  new URL('src/workspace/useDockviewPanelLifecycle.ts', root),
  'utf8',
)
const rendererRuntime = await readFile(new URL('src/rendererRuntime.tsx', root), 'utf8')
const renderLoopGuard = await readFile(new URL('src/shared/renderLoopGuard.ts', root), 'utf8')
const projectTerminalCwd = await readFile(
  new URL('src/workspace/useProjectTerminalCwd.ts', root),
  'utf8',
)
const terminalCreationController = await readFile(
  new URL('src/workspace/useTerminalCreationController.ts', root),
  'utf8',
)
const terminalAdoptionController = await readFile(
  new URL('src/workspace/useTerminalAdoptionController.ts', root),
  'utf8',
)
const workspaceSnapshotStore = await readFile(
  new URL('src/shared/WorkspaceSnapshotStore.ts', root),
  'utf8',
)

test('desktop inactivity wait validates the authenticated framed consumer identity', () => {
  assert.match(preload, /clientId: value\.clientId/u)
  assert.match(preload, /projectId: value\.projectId/u)
  assert.match(preload, /serverId: value\.serverId/u)
  assert.match(main, /request\.serverId !== serverTerminalAuthority\?\.service\.serverId/u)
  assert.match(main, /session\.projectId !== request\.projectId/u)
  assert.match(main, /serverTerminalAuthority\.isConsumerAttached\(/u)
  assert.doesNotMatch(
    main.slice(
      main.indexOf("'desktop:terminal-lifecycle-host:wait-for-inactivity'"),
      main.indexOf("'desktop:recording-service-host:get-state'"),
    ),
    /isRendererAttached/u,
  )
  assert.doesNotMatch(workspaceE2e, /terminayTerminalLifecycleHost\.waitForInactivity/u)
})

test('terminal panel installs one lossless event listener before replay handoff', () => {
  assert.match(panelClient, /readonly onEvent: \(listener:/u)
  assert.match(panel, /\.onEvent\(renderServerEvent\)/u)
  assert.ok(
    panel.indexOf(').onEvent(renderServerEvent)') <
      panel.indexOf('for (const event of attachment.initialEvents)'),
  )
})

test('settings singleton clears on close with replacement-safe identity', () => {
  assert.match(main, /!settingsWindow\.webContents\.isDestroyed\(\)/u)
  assert.match(main, /bindSingletonWindowLifecycle\(\s*createdSettingsWindow/u)
  assert.match(main, /await settingsWindowCloseBarrier/u)
  assert.match(main, /bindNativeWindowCloseBarrier\(\s*createdSettingsWindow/u)
  assert.doesNotMatch(
    main.slice(main.indexOf('function openSettingsWindow'), main.indexOf('async function connectRemoteServer')),
    /settingsWindow\.destroy\(\)/u,
  )
})

test('successful exit always reaches auto-close and presentation-only resize cannot detach', () => {
  const exitStart = panel.indexOf('const renderTerminalExit')
  const exitEnd = panel.indexOf('const renderTerminalOutput', exitStart)
  const exitHandler = panel.slice(exitStart, exitEnd)
  assert.ok(exitHandler.indexOf('TERMINAL_PANEL_EXIT_EVENT') < exitHandler.indexOf('if (notice === null)'))
  assert.match(panel, /panelAttachment\.resize\(next\)\.catch\(\(\) => \{\}\)/u)
  assert.match(panel, /attachment\.resize\(resize\)\.catch\(\(\) => \{\}\)/u)
  assert.match(panel, /terminal\.refresh\(0, terminal\.rows - 1\)/u)
  assert.match(panel, /window\.addEventListener\('focus', repaintTerminalOnWindowFocus\)/u)
})

test('project root command reads the canonical live cwd query', () => {
  assert.match(app, /useProjectTerminalCwd\(\s*terminalPanelClientContext/u)
  assert.match(projectTerminalCwd, /\.currentCwd\(context\.projectId, sessionId\)/u)
  assert.match(app, /workspaceSnapshotStore\.setProjectRoot\(/u)
  assert.match(workspaceSnapshotStore, /updateProjectRoot\(request, options\)/u)
  assert.match(workspaceSnapshotStore, /refreshPromise/u)
  assert.match(workspaceSnapshotStore, /refreshAgain/u)
  assert.doesNotMatch(workspaceSnapshotStore, /if \(!this\.synchronizing\) await this\.refresh\(\)/u)
})

test('empty workspace seeding is latched, yielded, bounded, and delta-idempotent', () => {
  assert.match(app, /initialTerminalSeedStartedRef\.current/u)
  assert.match(app, /initialTerminalSeedPromiseRef\.current/u)
  assert.match(app, /window\.setTimeout\(\(\) => resolve\(addTerminal\(\{\}\)\), 0\)/u)
  assert.match(app, /initialTerminalSeedAttempt < 1/u)
  assert.doesNotMatch(
    dockviewLifecycle,
    /initialTerminalSeededRef\.current\s*=\s*false/u,
  )

  const createResponse = terminalCreationController.slice(
    terminalCreationController.indexOf('export function useTerminalCreationController'),
  )
  assert.match(createResponse, /app\.workspace\.create\.await-delta/u)
  assert.doesNotMatch(createResponse, /api\.addPanel<TerminalPanelParams>/u)
  assert.match(createResponse, /panelId: presented\.panelId/u)
  assert.doesNotMatch(createResponse, /panelId: `pending:\$\{sessionId\}`/u)
  assert.match(
    terminalAdoptionController,
    /const acceptServerTerminal = useCallback\([\s\S]{0,800}panelSessionsRef\.current\.values\(\)\]\.includes\(sessionId\)[\s\S]{0,800}acceptMovedTerminal/u,
  )
})

test('connected context schedules an observable bounded React commit', () => {
  assert.match(rendererRuntime, /setTerminalClientContext\(labelledContext\)/u)
  assert.match(rendererRuntime, /renderer\.render\.connected/u)
  assert.match(rendererRuntime, /renderer\.commit\.connected/u)
  assert.match(app, /recordBoundedRendererRender\(\s*'app'/u)
  assert.match(app, /recordBoundedRendererRender\(\s*`project-workspace:/u)
  assert.match(renderLoopGuard, /next\.count > 64/u)
  assert.match(renderLoopGuard, /queueMicrotask/u)
})
