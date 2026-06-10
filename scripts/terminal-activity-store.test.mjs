import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'

const { TerminalActivityStore } = await importStore()

const SESSION = 'session-1'

function working(claimed = true) {
  return { status: 'working', claimed, attention: false, source: 'test' }
}
function idle(claimed = true, attention = false) {
  return { status: 'idle', claimed, attention, source: 'test' }
}

test('claimed working session shows recent; finishing shows unviewed; viewing clears it', () => {
  const store = new TerminalActivityStore()

  assert.equal(store.recordActivitySignal(SESSION, working(), 0).state, 'recent')

  // working → idle marks a finished unit of work.
  assert.equal(store.recordActivitySignal(SESSION, idle(), 10).state, 'unviewed')

  assert.equal(store.markViewed(SESSION, 20).state, 'viewed')
})

test('attention overrides other states and is sticky until viewed', () => {
  const store = new TerminalActivityStore()

  assert.equal(store.recordActivitySignal(SESSION, working(), 0).state, 'recent')
  assert.equal(store.recordActivitySignal(SESSION, idle(true, true), 10).state, 'attention')

  // Still attention on a plain re-evaluation.
  assert.equal(store.evaluate(SESSION, 5000).state, 'attention')

  // Viewing the tab acknowledges it.
  assert.equal(store.markViewed(SESSION, 5001).state, 'viewed')
})

test('user input clears a pending attention request', () => {
  const store = new TerminalActivityStore()

  assert.equal(store.recordActivitySignal(SESSION, idle(true, true), 0).state, 'attention')
  assert.equal(store.recordUserInput(SESSION, 10).state, 'viewed')
})

test('attention is suppressed for the focused tab but the finished state is not', () => {
  const store = new TerminalActivityStore()

  // A claimed agent finishes a turn and rings for attention while focused.
  store.recordActivitySignal(SESSION, working(), 0, { focused: true })
  const result = store.recordActivitySignal(SESSION, idle(true, true), 10, { focused: true })

  // No red dot on the tab you are looking at, but the finished (green) state
  // still applies — matching how active tabs surface completed work.
  assert.equal(result.state, 'unviewed')
})

test('raw output never moves a claimed session (the tips-bar repaint case)', () => {
  const store = new TerminalActivityStore()

  // Claimed + idle + acknowledged.
  store.recordActivitySignal(SESSION, idle(), 0)
  assert.equal(store.evaluate(SESSION, 0).state, 'viewed')

  // Spinner / tips-bar repaints keep arriving as raw output...
  store.recordTerminalActivity(SESSION, 100)
  store.recordTerminalActivity(SESSION, 200)

  // ...and the tab stays viewed; output is ignored for claimed sessions.
  assert.equal(store.evaluate(SESSION, 5000).state, 'viewed')
})

test('unclaimed sessions still use the raw-output timer', () => {
  const store = new TerminalActivityStore()

  store.recordTerminalActivity(SESSION, 0)
  // Past the green delay (1000ms) with no acknowledgement → finished.
  assert.equal(store.evaluate(SESSION, 2000).state, 'unviewed')
})

test('unclaimed host "working" (foreground) promotes an otherwise-quiet tab', () => {
  const store = new TerminalActivityStore()

  // Foreground process busy but no output and no claim (e.g. silent `sleep 30`).
  assert.equal(store.recordActivitySignal(SESSION, working(false), 0).state, 'recent')
})

test('signal detection can be disabled, reverting to pure output behaviour', () => {
  const store = new TerminalActivityStore()
  store.configure({}, { signalDetectionEnabled: false })

  // Signals are ignored entirely...
  assert.equal(store.recordActivitySignal(SESSION, idle(true, true), 0).state, 'viewed')

  // ...and only raw output drives the indicator.
  store.recordTerminalActivity(SESSION, 10)
  assert.equal(store.evaluate(SESSION, 2000).state, 'unviewed')
})

async function importStore() {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-activity-store-test-'))
  const outputPath = join(tempDir, 'store.mjs')
  await build({
    bundle: true,
    entryPoints: [new URL('../src/terminalActivityStore.ts', import.meta.url).pathname],
    format: 'esm',
    outfile: outputPath,
    platform: 'neutral',
    target: 'es2022',
  })
  return import(outputPath)
}
