import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MessageChannel } from 'node:worker_threads'
import { build } from 'esbuild'
import {
  FileViewerClient,
  TerminayClient,
  TerminayClientFacade,
  TerminayTerminalClient,
  WorkspaceClient,
} from '@terminay/client-core'

const {
  ServerPortTransport,
  ServerScopedMessagePort,
  ServerTerminalAuthority,
  TerminalService,
  TerminalServiceError,
} = await importAuthority()

test('Electron detaches authority consumers when a renderer is destroyed', async () => {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')

  assert.match(
    main,
    /app\.on\('web-contents-created',[\s\S]*?contents\.once\('destroyed',[\s\S]*?detachSessionsForWebContents\(contents\.id\)/u,
  )
  assert.match(
    main,
    /function detachSessionsForWebContents\(webContentsId: number\): void \{[\s\S]*?serverTerminalAuthority\?\.detachRendererAll\(webContentsId\)/u,
  )
  assert.doesNotMatch(
    main,
    /function detachSessionsForWebContents[\s\S]*?serverTerminalAuthority\?\.kill\(/u,
  )
})

function createPtyFactory() {
  const processes = []
  return {
    processes,
    spawn() {
      const exitListeners = new Set()
      const dataListeners = new Set()
      const process = {
        pid: 7_000 + processes.length,
        writes: [],
        resizes: [],
        write(bytes) { this.writes.push(new Uint8Array(bytes)) },
        resize(dimensions) { this.resizes.push({ ...dimensions }) },
        kills: 0,
        kill() { this.kills += 1 },
        onData(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener) },
        onExit(listener) { exitListeners.add(listener); return () => exitListeners.delete(listener) },
        emitData(data) { for (const listener of dataListeners) listener(data) },
        emitExit(exit = {}) { for (const listener of exitListeners) listener(exit) },
      }
      processes.push(process)
      return process
    },
  }
}

function writeAuthorization() {
  return { serverId: 'authority-server', projectId: 'authority-project', sessionId: 'authority-session', scope: 'write' }
}

test('trusted Desktop writes produce canonical OSC completion activity through the PTY boundary', async () => {
  const pty = createPtyFactory()
  const authority = new ServerTerminalAuthority({
    serverId: 'trusted-activity',
    terminalService: new TerminalService({
      serverId: 'trusted-activity',
      ptyFactory: pty,
      generateSessionId: () => 'activity-session',
    }),
  })
  try {
    const session = await authority.create({
      projectId: 'project-a',
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
    })
    const identity = {
      serverId: session.serverId,
      projectId: session.projectId,
      sessionId: session.id,
    }
    pty.processes[0].write = function (bytes) {
      this.writes.push(new Uint8Array(bytes))
      const command = new TextDecoder().decode(bytes)
      const marker = command.match(/(?:9;4;[03];|133;[CD](?:;0)?)/)?.[0]
      // A real PTY delivers output after accepting input. Preserve that
      // ordering so accepted user input cannot overwrite a completion marker
      // emitted synchronously by the test double.
      if (marker !== undefined) setImmediate(() => this.emitData(`\u001b]${marker}\u0007`))
    }

    await authority.write(session.id, "printf '\\033]9;4;3;\\007'\r")
    await new Promise(setImmediate)
    assert.equal(authority.activity.get(identity)?.status, 'working')
    await authority.write(session.id, "printf '\\033]9;4;0;\\007'\r")
    await new Promise(setImmediate)
    assert.equal(authority.activity.get(identity)?.status, 'idle')
    assert.equal(authority.activity.get(identity)?.acknowledged, true)
    await new Promise((resolve) => setTimeout(resolve, 2_100))
    assert.equal(authority.activity.get(identity)?.acknowledged, false)
    assert.equal(authority.activity.get(identity)?.source, 'structured:input-quiet')

    await authority.write(session.id, "printf '\\033]133;C\\007'\r")
    await new Promise(setImmediate)
    assert.equal(authority.activity.get(identity)?.status, 'working')
    await authority.write(session.id, "printf '\\033]133;D;0\\007'\r")
    await new Promise(setImmediate)
    assert.equal(authority.activity.get(identity)?.status, 'idle')
    assert.equal(authority.activity.get(identity)?.acknowledged, false)
    assert.equal(authority.activity.get(identity)?.source, 'structured:command')
  } finally {
    await authority.shutdown()
  }
})

test('embedded framed clients receive canonical agent and folder projections', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminay-embedded-projections-'))
  const initialRoot = join(root, 'initial')
  const updatedRoot = join(root, 'updated')
  await mkdir(initialRoot)
  await mkdir(join(updatedRoot, 'work', 'nested'), { recursive: true })
  await writeFile(join(updatedRoot, 'work', 'plan.md'), '# Plan\n- [ ] Root task\n')
  await writeFile(join(updatedRoot, 'work', 'nested', 'roadmap.md'), '# Roadmap\n- [x] Nested task\n')
  const pty = createPtyFactory()
  let nextSession = 0
  const authority = new ServerTerminalAuthority({
    serverId: 'embedded-projections',
    terminalService: new TerminalService({
      serverId: 'embedded-projections',
      ptyFactory: pty,
      generateSessionId: () => `session-${++nextSession}`,
    }),
  })
  const channel = new MessageChannel()
  let serverMessage
  let serverMessageError
  channel.port1.on('message', (data) => serverMessage?.({ data }))
  channel.port1.on('messageerror', () => serverMessageError?.())
  authority.acceptRendererPort({
    get onmessage() { return serverMessage },
    set onmessage(listener) { serverMessage = listener },
    get onmessageerror() { return serverMessageError },
    set onmessageerror(listener) { serverMessageError = listener },
    postMessage: (data) => channel.port1.postMessage(data),
    start: () => channel.port1.start(),
    close: () => channel.port1.close(),
  })
  const protocol = new TerminayClient({
    clientId: 'embedded-renderer',
    clientVersion: 'test',
    capabilities: ['terminal', 'files', 'agents'],
    transport: new ServerPortTransport(new ServerScopedMessagePort(channel.port2, 'embedded-projections')),
  })

  try {
    // Host registration mirrors Desktop's initial project/session adoption.
    const hostCreated = await authority.create({ projectId: 'desktop', cwd: initialRoot, cols: 80, rows: 24 })
    await protocol.connect()
    const facade = new TerminayClientFacade(protocol)
    const workspace = new WorkspaceClient(protocol)
    const terminals = new TerminayTerminalClient(protocol)
    const files = new FileViewerClient(facade)
    const hostWorkspace = await workspace.snapshot()
    assert.equal(hostWorkspace.terminalSessions[hostCreated.id]?.projectId, 'desktop')
    const hostPanel = Object.values(hostWorkspace.panels).find((panel) => panel.sessionId === hostCreated.id)
    assert.equal(hostPanel?.type, 'terminal')
    assert.equal(hostPanel?.title, 'Terminal 1')
    const created = await terminals.create({ projectId: 'desktop' })
    const identity = {
      serverId: 'embedded-projections',
      projectId: 'desktop',
      sessionId: created.sessionId,
    }
    // Production composition prepares this identity before spawning the PTY.
    // The injected TerminalService fixture deliberately has no lifecycle hook.
    authority.activity.register(identity)
    authority.agents.prepareTerminalSession(identity)
    const subscription = await protocol.subscribe('agent')
    const eventPromise = new Promise((resolve) => {
      const remove = subscription.onEvent((event) => {
        remove()
        resolve(event.payload)
      })
    })

    authority.agents.ingestHookPayload(
      identity,
      'codex',
      {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'codex-embedded-projection',
        prompt: 'Project canonical status',
        model: 'gpt-test-codex',
      },
    )

    const event = await eventPromise
    assert.equal(Object.values(event.entries)[0].activationTerminalSessionId, created.sessionId)
    assert.equal(Object.values(event.entries)[0].state, 'working')
    const snapshot = await protocol.query('agent.snapshot', {})
    assert.equal(Object.values(snapshot.result.entries)[0].activationTerminalSessionId, created.sessionId)

    const rootUpdate = await workspace.updateProjectRoot({
      projectId: 'desktop',
      root: updatedRoot,
      expectedRevision: authority.workspace.state.revision,
    }, { commandId: 'embedded-root-update' })
    assert.equal(rootUpdate.root.endsWith('/updated'), true)
    assert.equal(authority.workspace.state.projects.desktop.root, rootUpdate.root)
    const folder = await files.listFolder('work', 'desktop')
    assert.deepEqual(folder.entries.map((entry) => entry.name), ['nested', 'plan.md'])
    const tasks = await files.getFolderMarkdownTasks('work', 'desktop')
    assert.equal(tasks.stats.total, 2)
    assert.equal(tasks.stats.completed, 1)
    assert.deepEqual(tasks.files.map((file) => file.relativePath), ['work/plan.md', 'work/nested/roadmap.md'])

    await subscription.unsubscribe()
  } finally {
    await protocol.close().catch(() => undefined)
    channel.port1.close()
    channel.port2.close()
    await authority.shutdown()
    await rm(root, { recursive: true, force: true })
  }
})

test('ServerTerminalAuthority reports only accepted writes and resizes to host bookkeeping', async () => {
  const pty = createPtyFactory()
  const service = new TerminalService({
    serverId: 'authority-server',
    ptyFactory: pty,
    generateSessionId: () => 'authority-session',
  })
  const writes = []
  const resizes = []
  let process
  const authority = new ServerTerminalAuthority({
    serverId: 'authority-server',
    terminalService: service,
    onAcceptedWrite(event) {
      assert.equal(process.writes.length, 1, 'host observer runs after the PTY accepted the write')
      writes.push(event)
      return Promise.reject(new Error('recording observer failed'))
    },
    onAcceptedResize(event) {
      assert.equal(process.resizes.length, 1, 'host observer runs after the PTY accepted the resize')
      resizes.push(event)
      return Promise.reject(new Error('remote observer failed'))
    },
  })

  try {
    const session = await authority.create({
      projectId: 'authority-project',
      sessionId: 'authority-session',
      cwd: '/tmp',
      shellPath: '/bin/zsh',
      cols: 80,
      rows: 24,
    })
    assert.equal(session.shellPath, '/bin/zsh', 'authority snapshots retain the immutable launch shell')
    process = pty.processes[0]
    const input = new Uint8Array([0, 255])

    await authority.write('authority-session', input, writeAuthorization())
    input[0] = 9
    await authority.resize('authority-session', { cols: 120, rows: 40 }, writeAuthorization())

    assert.deepEqual(process.writes, [new Uint8Array([0, 255])])
    assert.deepEqual(process.resizes, [{ cols: 120, rows: 40 }])
    assert.deepEqual(writes, [{
      serverId: 'authority-server',
      projectId: 'authority-project',
      sessionId: 'authority-session',
      data: new Uint8Array([0, 255]),
    }])
    assert.deepEqual(resizes, [{
      serverId: 'authority-server',
      projectId: 'authority-project',
      sessionId: 'authority-session',
      cols: 120,
      rows: 40,
    }])

    await assert.rejects(
      authority.write('authority-session', 'forbidden', { ...writeAuthorization(), projectId: 'other-project' }),
      (error) => error instanceof TerminalServiceError && error.code === 'forbidden',
    )
    await assert.rejects(
      authority.resize('authority-session', { cols: 0, rows: 40 }, writeAuthorization()),
      (error) => error instanceof TerminalServiceError && error.code === 'invalid_dimensions',
    )
    assert.equal(writes.length, 1)
    assert.equal(resizes.length, 1)
  } finally {
    await authority.shutdown()
  }
})

test('ServerTerminalAuthority tracks renderer attachment per immutable session', async () => {
  const service = new TerminalService({
    serverId: 'authority-server',
    ptyFactory: createPtyFactory(),
    generateSessionId: () => 'attachment-session',
  })
  const authority = new ServerTerminalAuthority({
    serverId: 'authority-server',
    terminalService: service,
  })

  try {
    await authority.create({
      projectId: 'authority-project',
      sessionId: 'attachment-session',
      shellPath: '/bin/zsh',
      cwd: tmpdir(),
      cols: 80,
      rows: 24,
    })

    assert.equal(authority.isRendererAttached('attachment-session', 41), false)
    const detach = authority.attachRenderer('attachment-session', 41, () => {})
    assert.equal(authority.isRendererAttached('attachment-session', 41), true)
    assert.equal(authority.isRendererAttached('attachment-session', 42), false)
    detach()
    assert.equal(authority.isRendererAttached('attachment-session', 41), false)
  } finally {
    await authority.shutdown()
  }
})

test('ServerTerminalAuthority detaches every destroyed renderer consumer without killing the server PTY', async () => {
  const pty = createPtyFactory()
  const service = new TerminalService({
    serverId: 'authority-server',
    ptyFactory: pty,
    generateSessionId: () => 'detach-session',
  })
  const authority = new ServerTerminalAuthority({
    serverId: 'authority-server',
    terminalService: service,
  })

  try {
    await authority.create({
      projectId: 'authority-project',
      sessionId: 'detach-session',
      shellPath: '/bin/zsh',
      cwd: tmpdir(),
      cols: 80,
      rows: 24,
    })

    const destroyedRendererEvents = []
    const survivingRendererEvents = []
    authority.attachRenderer('detach-session', 41, (event) => destroyedRendererEvents.push(event))
    authority.attachRenderer('detach-session', 42, (event) => survivingRendererEvents.push(event))

    // This is the exact operation invoked by the global webContents
    // `destroyed` handler. It is consumer cleanup only: never a PTY kill.
    authority.detachRendererAll(41)

    assert.equal(authority.isRendererAttached('detach-session', 41), false)
    assert.equal(authority.isRendererAttached('detach-session', 42), true)
    assert.equal(pty.processes[0].kills, 0)

    pty.processes[0].emitData('still alive')
    assert.equal(pty.processes[0].kills, 0)
    assert.deepEqual(destroyedRendererEvents, [])
    assert.equal(survivingRendererEvents.length, 1)
    assert.equal(survivingRendererEvents[0].type, 'output')
  } finally {
    await authority.shutdown()
  }
})

test('ServerTerminalAuthority coalesces concurrent shutdown calls', async () => {
  const pty = createPtyFactory()
  const service = new TerminalService({
    serverId: 'authority-server',
    ptyFactory: pty,
    generateSessionId: () => 'shutdown-session',
  })
  const authority = new ServerTerminalAuthority({
    serverId: 'authority-server',
    terminalService: service,
  })

  await authority.create({
    projectId: 'authority-project',
    sessionId: 'shutdown-session',
    shellPath: '/bin/zsh',
    cwd: tmpdir(),
    cols: 80,
    rows: 24,
  })

  await Promise.all([authority.shutdown(), authority.shutdown()])
  assert.equal(pty.processes[0].kills ?? 0, 1)
})

test('ServerTerminalAuthority attachment checks reject a different renderer at runtime', async () => {
  const service = new TerminalService({
    serverId: 'authority-server',
    ptyFactory: createPtyFactory(),
    generateSessionId: () => 'attachment-runtime-session',
  })
  const authority = new ServerTerminalAuthority({
    serverId: 'authority-server',
    terminalService: service,
  })

  try {
    await authority.create({
      projectId: 'authority-project',
      sessionId: 'attachment-runtime-session',
      shellPath: '/bin/zsh',
      cwd: tmpdir(),
      cols: 80,
      rows: 24,
    })

    authority.attachRenderer('attachment-runtime-session', 41, () => {})
    assert.equal(authority.isRendererAttached('attachment-runtime-session', 41), true)
    assert.equal(authority.isRendererAttached('attachment-runtime-session', 42), false)
  } finally {
    await authority.shutdown()
  }
})

test('ServerTerminalAuthority hands a renderer stream to one destination without retaining the source', async () => {
  const pty = createPtyFactory()
  const service = new TerminalService({
    serverId: 'authority-server',
    ptyFactory: pty,
    generateSessionId: () => 'handoff-session',
  })
  const authority = new ServerTerminalAuthority({
    serverId: 'authority-server',
    terminalService: service,
  })
  const sourceEvents = []
  const destinationEvents = []

  try {
    await authority.create({
      projectId: 'authority-project',
      sessionId: 'handoff-session',
      shellPath: '/bin/zsh',
      cwd: tmpdir(),
      cols: 80,
      rows: 24,
    })
    authority.attachRenderer('handoff-session', 41, (event) => sourceEvents.push(event))
    pty.processes[0].emitData('before')

    authority.handoffRenderer('handoff-session', 41, 42, (event) => destinationEvents.push(event))
    pty.processes[0].emitData('after')

    assert.equal(authority.isRendererAttached('handoff-session', 41), false)
    assert.equal(authority.isRendererAttached('handoff-session', 42), true)
    assert.deepEqual(sourceEvents.filter((event) => event.type === 'output').map((event) => event.data), ['before'])
    assert.deepEqual(destinationEvents.filter((event) => event.type === 'output').map((event) => event.data), ['before', 'after'])
    assert.throws(
      () => authority.handoffRenderer('handoff-session', 41, 43, () => {}),
      /source renderer is not attached/u,
    )
  } finally {
    await authority.shutdown()
  }
})

async function importAuthority() {
  const directory = await mkdtemp(join(tmpdir(), 'terminay-server-terminal-authority-'))
  const outputPath = join(directory, 'authority.mjs')
  try {
    await build({
      bundle: true,
      format: 'esm',
      outfile: outputPath,
      platform: 'node',
      stdin: {
        contents: [
          `export { ServerTerminalAuthority } from ${JSON.stringify(new URL('../electron/serverTerminalAuthority.ts', import.meta.url).pathname)}`,
          `export { TerminalService } from ${JSON.stringify(new URL('../packages/server-core/src/terminalService/service.ts', import.meta.url).pathname)}`,
          `export { TerminalServiceError } from ${JSON.stringify(new URL('../packages/server-core/src/terminalService/errors.ts', import.meta.url).pathname)}`,
          `export { ServerPortTransport, ServerScopedMessagePort } from ${JSON.stringify(new URL('../src/shared/serverPortTransport.ts', import.meta.url).pathname)}`,
        ].join('\n'),
        loader: 'ts',
        resolveDir: process.cwd(),
      },
      target: 'node22',
    })
    return await import(outputPath)
  } finally {
    // The module remains loaded after import; the generated file is no longer
    // needed and must not become a worktree artifact.
    await rm(directory, { recursive: true, force: true })
  }
}
