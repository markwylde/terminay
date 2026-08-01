import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { MessageChannel } from 'node:worker_threads'
import { join } from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'
import { TerminayTerminalPanelClient } from '@terminay/client-core'
import {
  AgentStatusService,
  createServerCoreComposition,
  TerminalActivityService,
  WorkspaceRepository,
} from '@terminay/server-core'

const outputDirectory = await mkdtemp(join(process.cwd(), 'scripts', '.server-port-transport-'))
const outputFile = join(outputDirectory, 'serverPortTransport.mjs')
const rendererClientFile = join(outputDirectory, 'rendererServerClient.mjs')

await build({
  absWorkingDir: process.cwd(),
  bundle: true,
  entryPoints: ['src/shared/serverPortTransport.ts'],
  external: ['@terminay/protocol'],
  format: 'esm',
  outfile: outputFile,
  platform: 'node',
})
await build({
  absWorkingDir: process.cwd(),
  bundle: true,
  entryPoints: ['src/shared/rendererServerClient.ts'],
  external: ['@terminay/client-core'],
  format: 'esm',
  outfile: rendererClientFile,
  platform: 'node',
})

const { ServerPortTransport, ServerScopedMessagePort } = await import(outputFile)
const { connectRendererServerClient, createConnectedServerClientContext } = await import(rendererClientFile)
globalThis.window = globalThis

test.after(async () => {
  await rm(outputDirectory, { recursive: true, force: true })
})

test('server-scoped MessagePorts carry only framed bytes for the selected server', async () => {
  const { port1, port2 } = new MessageChannel()
  const left = new ServerPortTransport(new ServerScopedMessagePort(port1, 'desktop-local'))
  const right = new ServerPortTransport(new ServerScopedMessagePort(port2, 'desktop-local'))

  try {
    await Promise.all([left.open(), right.open()])
    const received = right.incoming[Symbol.asyncIterator]().next()
    await left.send(new Uint8Array([1, 2, 3]))
    assert.deepEqual([...((await received).value)], [1, 2, 3])
    assert.equal(left.state, 'open')
    assert.equal(right.state, 'open')
  } finally {
    await Promise.all([left.close(), right.close()])
  }
})

test('normal peer closure terminates incoming work and releases a server connection slot', async () => {
  const { port1, port2 } = new MessageChannel()
  const transport = new ServerPortTransport(new ServerScopedMessagePort(port1, 'desktop-local'))
  const core = createServerCoreComposition({
    serverId: 'desktop-local',
    serverVersion: 'test',
    capabilities: [],
    maxConnections: 1,
    ptyFactory: {
      spawn() {
        throw new Error('terminal spawn is not used by this connection test')
      },
    },
  }).core
  const connection = core.accept(transport)
  const task = connection.start()

  port2.close()
  await assert.rejects(task, /server port closed/u)

  assert.equal(transport.state, 'failed')
  const replacementChannel = new MessageChannel()
  const replacementTransport = new ServerPortTransport(
    new ServerScopedMessagePort(replacementChannel.port1, 'desktop-local'),
  )
  const replacement = core.accept(replacementTransport)
  await replacement.close()
  replacementChannel.port2.close()
})

test('a frame from another server is rejected before it reaches the transport', async () => {
  const { port1, port2 } = new MessageChannel()
  const scoped = new ServerScopedMessagePort(port1, 'desktop-local')
  const transport = new ServerPortTransport(scoped)
  let errors = 0
  scoped.onmessageerror = () => { errors += 1 }

  try {
    await transport.open()
    port2.postMessage({
      type: 'terminay.server-frame',
      version: 1,
      serverId: 'other-server',
      frame: new Uint8Array([1]),
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(errors, 1)
    assert.equal(transport.state, 'open')
  } finally {
    await transport.close()
  }
})

test('the renderer connector aborts a server handshake that never replies', async () => {
  const { port1, port2 } = new MessageChannel()
  try {
    await assert.rejects(
      connectRendererServerClient('desktop-local', port2, { connectionTimeoutMs: 10 }),
      (error) => error?.message === 'connection handshake failed' &&
        error.cause?.message === 'server handshake timed out after 10ms',
    )
  } finally {
    port1.close()
    port2.close()
  }
})

test('canonical renderer setup closes a client whose subscription never settles', async () => {
  let closed = 0
  const client = {
    close: async () => { closed += 1 },
    subscribe: async () => new Promise(() => {}),
  }
  await assert.rejects(
    createConnectedServerClientContext(client, { clientId: 'client', serverId: 'desktop-local' }, { setupTimeoutMs: 10 }),
    /activity subscription timed out after 10ms/u,
  )
  assert.equal(closed, 1)
})

const setupPhaseCases = [
  ['activity subscription', { stalledSubscription: 'activity' }],
  ['agent-status subscription', { stalledSubscription: 'agent' }],
  ['workspace subscription', { stalledSubscription: 'workspace.changed' }],
  ['workspace snapshot', { stalledQuery: 'workspace.snapshot' }],
]

for (const [phase, stall] of setupPhaseCases) {
  test(`canonical renderer setup reports and cleans up a stalled ${phase}`, async () => {
    let closed = 0
    const client = {
      close: async () => { closed += 1 },
      subscribe: async (event) => {
        if (stall.stalledSubscription === event) return new Promise(() => {})
        return {
          onEvent: () => () => {},
          onResync: () => () => {},
          unsubscribe: async () => {},
        }
      },
      query: async (operation) => {
        if (stall.stalledQuery === operation) return new Promise(() => {})
        if (operation === 'activity.snapshot') {
          return { result: { serverId: 'desktop-local', revision: 0, cursor: '0', sessions: {} } }
        }
        if (operation === 'agent.snapshot') {
          return { result: { revision: 0, cursor: '0', entries: {} } }
        }
        if (operation === 'workspace.snapshot') {
          return {
            result: {
              schemaVersion: 1,
              serverId: 'desktop-local',
              revision: 0,
              cursor: '0',
              viewOrder: [],
              views: {},
              projects: {},
              panels: {},
              terminalSessions: {},
            },
          }
        }
        throw new Error(`unexpected query ${operation}`)
      },
      command: async () => ({ result: null }),
    }

    await assert.rejects(
      createConnectedServerClientContext(
        client,
        { clientId: 'client', serverId: 'desktop-local' },
        { setupTimeoutMs: 10 },
      ),
      new RegExp(`${phase} timed out after 10ms`, 'u'),
    )
    assert.equal(closed, 1)
  })
}

test('the production renderer connector attaches through the server-owned composition', async () => {
  const processes = []
  const activity = new TerminalActivityService({ serverId: 'desktop-local' })
  const agents = new AgentStatusService({
    activity,
    receiver: { tokenFactory: () => 'server-port-agent-token' },
  })
  const workspace = new WorkspaceRepository({
    load: async () => undefined,
    commit: async () => {},
  }, 'desktop-local')
  await workspace.load()
  const composition = createServerCoreComposition({
    serverId: 'desktop-local',
    serverVersion: 'test',
    capabilities: ['terminal'],
    activity,
    agents,
    workspace,
    ptyFactory: {
      spawn(options) {
        const dataListeners = new Set()
        const exitListeners = new Set()
        const process = {
          pid: 12_001,
          options,
          writes: [],
          resizes: [],
          write(bytes) { this.writes.push(new Uint8Array(bytes)) },
          resize(dimensions) { this.resizes.push({ ...dimensions }) },
          kill() {},
          onData(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener) },
          onExit(listener) { exitListeners.add(listener); return () => exitListeners.delete(listener) },
          emitData(value) {
            const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
            for (const listener of dataListeners) listener(bytes)
          },
          emitExit(value = {}) { for (const listener of exitListeners) listener(value) },
        }
        processes.push(process)
        return process
      },
    },
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: 'admin' }),
    terminalOptions: { generateSessionId: () => 'session-renderer' },
  })
  await composition.start()
  const session = await composition.terminal.createSession({ projectId: 'project-renderer', cols: 80, rows: 24 })
  const { port1, port2 } = new MessageChannel()
  const serverTransport = new ServerPortTransport(new ServerScopedMessagePort(port1, 'desktop-local'))
  const server = composition.core.accept(serverTransport)
  const serverTask = server.start()
  let context

  try {
    context = await connectRendererServerClient('desktop-local', port2)
    const panel = await new TerminayTerminalPanelClient(context.client).attach({
      serverId: context.serverId,
      projectId: 'project-renderer',
      sessionId: session.sessionId,
      clientId: context.clientId,
    })
    const output = new Promise((resolve) => panel.onOutput(resolve))
    const rawBytes = new Uint8Array([0x00, 0xff, 0x1b, 0xc3, 0xa9])
    processes[0].emitData(rawBytes)
    const event = await output
    assert.deepEqual([...event.bytes], [...rawBytes])
    await panel.ack(event.nextPosition)
    await panel.write('echo from renderer')
    await panel.resize({ cols: 100, rows: 30 })
    assert.deepEqual([...processes[0].writes[0]], [...new TextEncoder().encode('echo from renderer')])
    assert.deepEqual(processes[0].resizes, [{ cols: 100, rows: 30 }])
    await panel.detach()
  } finally {
    // Projection disposal starts authenticated unsubscribe commands. Let those
    // commands settle while the client and server are still connected before
    // closing their shared transport.
    context?.workspaceSnapshotStore.close()
    context?.activityClient.close()
    context?.agentStatusClient.close()
    await context?.applicationClient.query('workspace.snapshot', {})
    await context?.dispose()
    await composition.shutdown()
    await serverTask.catch(() => undefined)
    await serverTransport.close().catch(() => undefined)
  }
})
