import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

const { createGracefulQuitHandler } = await importGracefulQuit()

test('Electron before-quit delegates authority teardown through the graceful gate', async () => {
  const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
  assert.match(main, /const handleBeforeQuit = createGracefulQuitHandler\(/u)
  assert.match(main, /serverTerminalAuthority\?\.shutdown\(\)/u)
  assert.match(main, /app\.on\('before-quit', \(event\) => \{[\s\S]*handleBeforeQuit\(event\)/u)
  assert.doesNotMatch(main, /void serverTerminalAuthority\?\.shutdown\(\)/u)
})

test('before-quit waits for cleanup, coalesces repeat events, then permits the final quit', async () => {
  let resolveShutdown
  const shutdown = new Promise((resolve) => { resolveShutdown = resolve })
  let cleanupCalls = 0
  let quitCalls = 0
  const handler = createGracefulQuitHandler({
    app: { quit: () => { quitCalls += 1 } },
    shutdown: async () => {
      cleanupCalls += 1
      await shutdown
    },
  })
  const first = createEvent()
  const duplicate = createEvent()

  handler(first.event)
  handler(duplicate.event)
  assert.equal(first.prevented(), 1)
  assert.equal(duplicate.prevented(), 1)
  assert.equal(cleanupCalls, 0)
  assert.equal(quitCalls, 0)

  await Promise.resolve()
  assert.equal(cleanupCalls, 1)
  resolveShutdown()
  await waitFor(() => quitCalls === 1)

  const finalQuit = createEvent()
  handler(finalQuit.event)
  assert.equal(finalQuit.prevented(), 0)
  assert.equal(cleanupCalls, 1)
})

test('before-quit logs cleanup failure but still completes the quit path', async () => {
  const errors = []
  let quitCalls = 0
  const handler = createGracefulQuitHandler({
    app: { quit: () => { quitCalls += 1 } },
    shutdown: async () => { throw new Error('close failed') },
    onShutdownError: (error) => errors.push(error),
  })
  const event = createEvent()
  handler(event.event)
  await waitFor(() => quitCalls === 1)
  assert.equal(event.prevented(), 1)
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /close failed/u)
})

function createEvent() {
  let preventions = 0
  return {
    event: { preventDefault: () => { preventions += 1 } },
    prevented: () => preventions,
  }
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  assert.fail('condition did not become true')
}

async function importGracefulQuit() {
  const directory = await mkdtemp(join(tmpdir(), 'terminay-graceful-quit-'))
  const outputPath = join(directory, 'graceful-quit.mjs')
  try {
    await build({
      bundle: true,
      format: 'esm',
      outfile: outputPath,
      platform: 'node',
      stdin: {
        contents: `export { createGracefulQuitHandler } from ${JSON.stringify(new URL('../electron/gracefulQuit.ts', import.meta.url).pathname)}`,
        loader: 'ts',
        resolveDir: process.cwd(),
      },
      target: 'node24',
    })
    return await import(outputPath)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
