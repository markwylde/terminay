import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

const authorityPath = new URL('../electron/serverTerminalAuthority.ts', import.meta.url)
const mainPath = new URL('../electron/main.ts', import.meta.url)

test('Task 9 renderer handoff is owned by ServerTerminalAuthority', async () => {
  const source = await readFile(authorityPath, 'utf8')

  assert.match(source, /handoffRenderer\([\s\S]*?fromRendererId[\s\S]*?toRendererId[\s\S]*?listener/u)
  assert.match(source, /if \(!this\.isRendererAttached\(id, fromRendererId\)\)/u)
  assert.match(source, /this\.attachRenderer\(id, toRendererId, listener, fromPosition\)[\s\S]*?this\.detachRenderer\(id, fromRendererId\)/u)
})

test('Task 9 popout and merge preserve framed server ownership with optional legacy handoff', async () => {
  const source = await readFile(mainPath, 'utf8')

  assert.match(source, /serverTerminalAuthority\.handoffRenderer\(sessionId, sourceWebContentsId, newWebContentsId, listener\)[\s\S]*?controlTokensBySession/u)
  assert.match(source, /if \(!serverTerminalAuthority\?\.isRendererAttached\(sessionId, sourceWebContentsId\)\)[\s\S]*?return/u)
  assert.match(source, /reassignSessionOwner\(terminal\.sessionId, event\.sender\.id, window\.webContents\.id\)/u)
  assert.match(source, /reassignSessionOwner\(terminal\.sessionId, event\.sender\.id, target\.id\)/u)
  assert.match(source, /project\.terminals\.every\(\(terminal\) =>[\s\S]*?serverTerminalAuthority\.get\(terminal\.sessionId\) !== undefined/u)
})

const { ServerTerminalAuthority, TerminalService } = await importAuthority()

test('Task 9 renderer handoff preserves the PTY and transfers the sole legacy attachment', async () => {
  const pty = createPtyFactory()
  const authority = new ServerTerminalAuthority({
    serverId: 'task9-server',
    terminalService: new TerminalService({
      serverId: 'task9-server',
      ptyFactory: pty,
      generateSessionId: () => 'task9-session',
    }),
  })
  const sourceEvents = []
  const destinationEvents = []

  try {
    await authority.create({
      projectId: 'task9-project',
      sessionId: 'task9-session',
      cwd: process.cwd(),
      shellPath: '/bin/zsh',
      cols: 80,
      rows: 24,
    })
    authority.attachRenderer('task9-session', 41, (event) => sourceEvents.push(event))
    pty.processes[0].emitData('before-handoff')

    authority.handoffRenderer('task9-session', 41, 42, (event) => destinationEvents.push(event))
    pty.processes[0].emitData('after-handoff')

    assert.equal(authority.isRendererAttached('task9-session', 41), false)
    assert.equal(authority.isRendererAttached('task9-session', 42), true)
    assert.equal(pty.processes[0].kills, 0, 'moving a renderer subscription must not own or kill the PTY')
    assert.deepEqual(sourceEvents.filter((event) => event.type === 'output').map((event) => event.data), ['before-handoff'])
    assert.deepEqual(destinationEvents.filter((event) => event.type === 'output').map((event) => event.data), ['before-handoff', 'after-handoff'])

    assert.throws(
      () => authority.handoffRenderer('task9-session', 41, 43, () => {}),
      /source renderer is not attached/u,
    )
    assert.equal(authority.isRendererAttached('task9-session', 43), false)
    assert.equal(pty.processes[0].kills, 0)
  } finally {
    await authority.shutdown()
  }
})

function createPtyFactory() {
  const processes = []
  return {
    processes,
    spawn() {
      const dataListeners = new Set()
      const exitListeners = new Set()
      const process = {
        pid: 9_000 + processes.length,
        kills: 0,
        write() {},
        resize() {},
        kill() { this.kills += 1 },
        onData(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener) },
        onExit(listener) { exitListeners.add(listener); return () => exitListeners.delete(listener) },
        emitData(data) { for (const listener of dataListeners) listener(data) },
      }
      processes.push(process)
      return process
    },
  }
}

async function importAuthority() {
  const directory = await mkdtemp(join(tmpdir(), 'terminay-task9-renderer-handoff-'))
  const outputPath = join(directory, 'authority.mjs')
  try {
    await build({
      bundle: true,
      format: 'esm',
      outfile: outputPath,
      platform: 'node',
      stdin: {
        contents: [
          `export { ServerTerminalAuthority } from ${JSON.stringify(authorityPath.pathname)}`,
          `export { TerminalService } from ${JSON.stringify(new URL('../packages/server-core/src/terminalService/service.ts', import.meta.url).pathname)}`,
        ].join('\n'),
        loader: 'ts',
        resolveDir: process.cwd(),
      },
      target: 'node22',
    })
    return await import(outputPath)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
