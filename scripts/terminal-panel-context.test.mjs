import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const panel = await readFile(new URL('../src/components/TerminalPanel.tsx', import.meta.url), 'utf8')
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

test('TerminalPanel resolves the shared connection client before compatibility APIs', () => {
  assert.match(panel, /export const TerminalPanelClientContext/)
  assert.match(panel, /const terminalClientContext = useContext\(TerminalPanelClientContext\)/)
  assert.match(panel, /new TerminayTerminalPanelClient\(terminalClientContext\.client\)/)
  assert.match(panel, /resolveTerminalPanelClient\(/)
  assert.match(panel, /params\.terminalPanelClient \?\?/)
  assert.match(panel, /context === null\s*\n\s*\? undefined/)
	assert.match(panel, /const panelClient = resolvedTerminalClient\.panelClient/)
	assert.match(panel, /const panelIdentity = resolvedTerminalClient\.identity/)
	assert.match(panel, /const panelClientId = resolvedTerminalClient\.clientId/)
	assert.match(panel, /type TerminalPanelConnectionContext = Pick</)
	assert.match(panel, /'client'\s*\n\s*\| 'serverId'\s*\n\s*\| 'projectId'\s*\n\s*\| 'clientId'/)
	assert.match(panel, /const terminalPanelConnectionContext\s*=\s*useMemo<TerminalPanelConnectionContext \| null>/)
	assert.match(panel, /browserFileDropContextRef\.current/)
	assert.match(panel, /retryServerAttachmentRef\.current\(\)/)
	assert.match(panel, /Retry connection/)
})

test('terminal retry reattaches this panel instead of replacing the workspace transport', () => {
  const retryStart = panel.indexOf('retryServerAttachmentRef.current = () => {')
  const retryEnd = panel.indexOf('rebindServerAttachmentRef.current = ({', retryStart)
  assert.notEqual(retryStart, -1)
  assert.notEqual(retryEnd, -1)
  const retry = panel.slice(retryStart, retryEnd)

  assert.match(retry, /serverAttachmentFailed = false/)
  assert.match(retry, /forceResume: true/)
  assert.doesNotMatch(retry, /retryConnection\(\)/)

  const attachStart = panel.indexOf('const attachServerTerminal = ({')
  const attachEnd = panel.indexOf('const beginTerminalResync', attachStart)
  assert.notEqual(attachStart, -1)
  assert.notEqual(attachEnd, -1)
  const attach = panel.slice(attachStart, attachEnd)
  assert.match(attach, /attachmentClient\.resume\(nextRequest\)/)
  assert.match(attach, /isTerminalSessionEndedError/)
})

test('replacement context reports mounted attachment hydration only after rendering initial events', () => {
  const renderStart = panel.indexOf('const initialEventsRendered = terminalRenderQueue')
  const attachStart = panel.indexOf('serverInputQueue?.attach(attachment)', renderStart)
  const hydrationReport = panel.indexOf('terminalPanelConnectionContext?.reportConnectionHydrated?.()', renderStart)
  assert.notEqual(renderStart, -1)
  assert.ok(hydrationReport > renderStart)
  assert.ok(hydrationReport < attachStart)
})

test('mounted terminal keeps one client facade while replacement calls use the new delegate', async () => {
  const outputDirectory = await mkdtemp(join(process.cwd(), 'scripts', '.terminal-panel-replacement-'))
  try {
    await build({
      absWorkingDir: process.cwd(), bundle: true, entryPoints: ['src/components/TerminalPanel.tsx'],
      external: ['react', 'react-dom', '@terminay/client-core'], format: 'esm', loader: { '.css': 'empty' },
      outdir: outputDirectory, platform: 'node',
      plugins: [{ name: 'stubs', setup(api) {
        api.onResolve({ filter: /^@xterm\/|^lucide-react$/ }, (args) => ({ path: args.path, namespace: 'stub' }))
        api.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export class Terminal {}; export class FitAddon {}; export class SearchAddon {}; export class Unicode11Addon {}; export class WebLinksAddon {}; export const AlertTriangle=0, Mic=0, RotateCcw=0, Square=0, X=0;', loader: 'js' }))
      } }],
    })
    const module = await import(pathToFileURL(join(outputDirectory, 'TerminalPanel.js')).href)
    let delegate = { attach: async () => 'old' }
    const facade = module.createReplaceableTerminalPanelClient(() => delegate)
    assert.equal(await facade.attach({}), 'old')
    delegate = { attach: async () => 'replacement' }
    assert.equal(await facade.attach({}), 'replacement')
  } finally { await rm(outputDirectory, { force: true, recursive: true }) }
})

test('a replacement hydration generation rebinds even when logical client identity is stable', () => {
  assert.match(panel, /boundHydrationReporterRef/u)
  assert.match(panel, /terminalClientContext\?\.applicationClient,\s*terminalClientContext\?\.client,\s*terminalClientContext\?\.clientId,\s*terminalClientContext\?\.reportConnectionHydrated/u)
  assert.match(panel, /new TerminayTerminalClient\(terminalClientContext\.applicationClient\)/u)
  assert.match(panel, /rebindServerAttachmentRef\.current\(\{\s*client: replacementClient,\s*clientId: terminalClientContext\.clientId,\s*\}\)/u)
  assert.match(panel, /client: replacementClient/u)
  assert.match(panel, /clientId: replacementClientId/u)
  assert.match(panel, /attachmentClient\.resume\(nextRequest\)/u)
})

test('workspace metadata and drop-upload changes do not rebuild a mounted terminal attachment', () => {
  const containerAssign = panel.indexOf('const container = containerRef.current')
  const lifecycleStart = panel.lastIndexOf('useEffect(() => {', containerAssign)
  const lifecycleEnd = panel.indexOf('if (terminalClientContext?.client === undefined)', containerAssign)
  assert.notEqual(lifecycleStart, -1)
  assert.notEqual(lifecycleEnd, -1)
  const lifecycle = panel.slice(lifecycleStart, lifecycleEnd)
  const depStart = lifecycle.lastIndexOf('}, [')
  const depEnd = lifecycle.indexOf(']);', depStart)
  assert.notEqual(depStart, -1)
  assert.notEqual(depEnd, -1)
  const dependencies = lifecycle.slice(depStart, depEnd + 3)

  assert.match(lifecycle, /const canUploadBrowserFiles = \(\) =>/)
  assert.match(lifecycle, /const browserDropContext = browserFileDropContextRef\.current/)
  assert.match(lifecycle, /renderedPositionRef\.current = nextPosition/)
  assert.match(lifecycle, /fromPosition: renderedPositionRef\.current \?\? 0/)
  assert.match(lifecycle, /freshPresentation: false/)
  assert.match(lifecycle, /freshPresentation: true/)
  assert.doesNotMatch(dependencies, /\b(terminalClientContext|projectRoot|fileViewerClient|settings)\b/)
  assert.match(dependencies, /resolvedTerminalClient/)
  assert.match(dependencies, /props\.params\.sessionId/)
})

test('App provides one connection client context per project Dockview and keeps null as the fallback', () => {
  assert.match(app, /terminalClientContext\?: Omit<TerminalPanelClientContextValue, 'projectId'>/)
  assert.match(app, /const terminalPanelClientContext\s*=\s*useMemo<TerminalPanelClientContextValue \| null>/)
  assert.match(app, /<TerminalPanelClientContext\.Provider\s+value=\{terminalPanelClientContext\}\s*>/)
  assert.match(app, /terminalClientContext=\{terminalClientContext\}/)
  assert.match(app, /terminal: TerminalPanel/)
})

test('context resolution uses the supplied shared terminal client for a real attachment', async () => {
  const outputDirectory = await mkdtemp(join(process.cwd(), 'scripts', '.terminal-panel-context-'))
  try {
    const stubExports = {
      '@xterm/xterm': 'export class Terminal {}',
      '@xterm/addon-fit': 'export class FitAddon {}',
      '@xterm/addon-search': 'export class SearchAddon {}',
      '@xterm/addon-unicode11': 'export class Unicode11Addon {}',
      '@xterm/addon-web-links': 'export class WebLinksAddon {}',
      'lucide-react': 'export const AlertTriangle=0, Mic=0, RotateCcw=0, Square=0, X=0;',
    }

    await build({
      absWorkingDir: process.cwd(),
      bundle: true,
      entryPoints: ['src/components/TerminalPanel.tsx'],
      external: ['react', 'react-dom', '@terminay/client-core'],
      format: 'esm',
      loader: { '.css': 'empty' },
      outdir: outputDirectory,
      platform: 'node',
      plugins: [{
        name: 'terminal-panel-test-stubs',
        setup(api) {
          api.onResolve({ filter: /^@xterm\// }, (args) => ({ path: args.path, namespace: 'test-stub' }))
          api.onResolve({ filter: /^lucide-react$/ }, (args) => ({ path: args.path, namespace: 'test-stub' }))
          api.onLoad({ filter: /.*/, namespace: 'test-stub' }, (args) => ({ contents: stubExports[args.path] ?? '', loader: 'js' }))
        },
      }],
    })

    const module = await import(pathToFileURL(join(outputDirectory, 'TerminalPanel.js')).href)
    let capturedRequest
    const attachmentListeners = new Set()
    const attachment = {
      attachmentId: 'attachment-context',
      identity: { serverId: 'server-context', projectId: 'project-context', sessionId: 'session-context' },
      initialEvents: [],
      position: 0,
      closed: false,
      onEvent: (listener) => {
        attachmentListeners.add(listener)
        return () => attachmentListeners.delete(listener)
      },
      ack: async () => {},
      write: async () => {},
      resize: async () => {},
      kill: async () => {},
      detach: async () => {},
    }
    const sharedClient = {
      attach: async (request) => {
        capturedRequest = request
        return attachment
      },
      resume: async () => attachment,
    }
    const resolved = module.resolveTerminalPanelClient({}, {
      client: sharedClient,
      serverId: 'server-context',
      projectId: 'project-context',
      clientId: 'client-context',
    })

    const attached = await resolved.panelClient.attach({
      serverId: 'server-context',
      projectId: 'project-context',
      sessionId: 'session-context',
      clientId: 'client-context',
    })

    assert.deepEqual(resolved.identity, { serverId: 'server-context', projectId: 'project-context' })
    assert.equal(resolved.clientId, 'client-context')
    assert.equal(attached.attachmentId, 'attachment-context')
    assert.deepEqual(capturedRequest, {
      serverId: 'server-context',
      projectId: 'project-context',
      sessionId: 'session-context',
      clientId: 'client-context',
    })

    const outputEvents = []
    const stopOutput = attached.onOutput((event) => outputEvents.push(event.bytes))
    for (const listener of attachmentListeners) {
      listener({
        type: 'output',
        serverId: 'server-context',
        projectId: 'project-context',
        sessionId: 'session-context',
        position: 0,
        nextPosition: 2,
        bytes: new Uint8Array([0, 255]),
        replay: false,
      })
      listener({
        type: 'exit',
        serverId: 'server-context',
        projectId: 'project-context',
        sessionId: 'session-context',
        exitCode: 0,
        signal: null,
      })
    }
    stopOutput()
    assert.deepEqual(outputEvents.map((bytes) => [...bytes]), [[0, 255]])

    const compatibility = module.resolveTerminalPanelClient({}, null)
    assert.equal(compatibility.panelClient, undefined)
    assert.equal(compatibility.identity, undefined)
    assert.equal(compatibility.clientId, undefined)
  } finally {
    await rm(outputDirectory, { recursive: true, force: true })
  }
})
