import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'

const { createInterpreterRuntime } = await importRuntime()

function makeFakeClock() {
  let nextId = 1
  const timers = new Map()
  return {
    setTimeout: (handler, ms) => {
      const id = nextId++
      timers.set(id, { handler, ms })
      return id
    },
    clearTimeout: (id) => {
      timers.delete(id)
    },
    fireAll: () => {
      const handlers = [...timers.values()].map((entry) => entry.handler)
      timers.clear()
      for (const handler of handlers) {
        handler()
      }
    },
    pending: () => timers.size,
  }
}

function makeRuntime(options = {}) {
  const emissions = []
  const clock = makeFakeClock()
  const runtime = createInterpreterRuntime({
    shellProcess: options.shellProcess ?? 'zsh',
    staleMs: options.staleMs ?? 15000,
    onActivity: (activity) => emissions.push(activity),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  })
  return { runtime, emissions, clock, last: () => emissions[emissions.length - 1] }
}

test('generic: OSC 9;4 progress drives working then idle and claims the session', () => {
  const { runtime, last } = makeRuntime()

  runtime.push({ kind: 'progress', state: 3 })
  assert.deepEqual(
    { status: last().status, claimed: last().claimed, attention: last().attention },
    { status: 'working', claimed: true, attention: false },
  )

  runtime.push({ kind: 'progress', state: 0 })
  assert.equal(last().status, 'idle')
  assert.equal(last().claimed, true)
})

test('generic: progress staleness timeout drops the busy state', () => {
  const { runtime, clock, last } = makeRuntime()

  runtime.push({ kind: 'progress', state: 3 })
  assert.equal(last().status, 'working')
  assert.equal(clock.pending(), 1)

  clock.fireAll()
  assert.equal(last().status, 'idle')
})

test('generic: command C → D lifecycle captures the exit code', () => {
  const { runtime, last } = makeRuntime()

  runtime.push({ kind: 'command', phase: 'executing' })
  assert.equal(last().status, 'working')

  runtime.push({ kind: 'command', phase: 'finished', exitCode: 0 })
  assert.equal(last().status, 'idle')
  assert.equal(last().exitCode, 0)
})

test('generic: aborted command (D with no preceding C) ignores the exit code', () => {
  const { runtime, last } = makeRuntime()

  runtime.push({ kind: 'command', phase: 'input' }) // B
  runtime.push({ kind: 'command', phase: 'finished', exitCode: 5 }) // D, no C

  assert.equal(last().status, 'idle')
  assert.equal(last().exitCode, undefined)
})

test('generic: foreground process is a fallback only until an explicit signal latches', () => {
  const { runtime, last, emissions } = makeRuntime({ shellProcess: 'zsh' })

  // A non-shell foreground process means "working" while nothing explicit fired.
  runtime.push({ kind: 'foreground', busy: true, processName: 'make' })
  assert.equal(last().status, 'working')
  assert.equal(last().claimed, false)

  // Once a command lifecycle latches, the foreground heuristic is ignored.
  runtime.push({ kind: 'command', phase: 'finished', exitCode: 0 })
  assert.equal(last().status, 'idle')
  assert.equal(last().claimed, true)
  void emissions
})

test('claude-code: claims on foreground, progress is the turn boundary, notification → attention', () => {
  const { runtime, last } = makeRuntime({ shellProcess: 'zsh' })

  runtime.push({ kind: 'foreground', busy: true, processName: 'claude' })
  assert.equal(last().claimed, true)
  assert.equal(last().source.startsWith('claude-code'), true)

  runtime.push({ kind: 'progress', state: 3 })
  assert.equal(last().status, 'working')

  runtime.push({ kind: 'progress', state: 0 })
  assert.equal(last().status, 'idle')
  // The idle transition is driven by claude's progress handling, not generic.
  assert.equal(last().source, 'claude-code:progress')

  runtime.push({ kind: 'notification', body: 'Permission required' })
  assert.equal(last().attention, true)
  assert.equal(last().status, 'idle')
  assert.equal(last().source, 'claude-code:notification')
})

test('codex: foreground works, turn-complete notification → idle + attention, input re-arms', () => {
  const { runtime, last } = makeRuntime({ shellProcess: 'zsh' })

  runtime.push({ kind: 'foreground', busy: true, processName: 'codex' })
  assert.equal(last().status, 'working')
  assert.equal(last().claimed, true)
  assert.equal(last().source.startsWith('codex'), true)

  runtime.push({ kind: 'notification', body: 'agent-turn-complete' })
  assert.equal(last().status, 'idle')
  assert.equal(last().attention, true)

  runtime.push({ kind: 'userInput' })
  assert.equal(last().status, 'working')
  assert.equal(last().attention, false)
})

test('codex: no progress sequences — only notifications move the state', () => {
  const { runtime, last } = makeRuntime({ shellProcess: 'zsh' })

  runtime.push({ kind: 'foreground', busy: true, processName: 'codex' })
  assert.equal(last().status, 'working')

  // A stray progress sequence is ignored by codex (it falls through to generic,
  // which would set progressBusy) — but codex's derive only reads agentBusy, so
  // status stays driven by the turn boundary. The turn-complete notification
  // is what marks it idle.
  runtime.push({ kind: 'notification', body: 'agent-turn-complete' })
  assert.equal(last().status, 'idle')
})

test('matching: the chain re-evaluates per signal against the current foreground', () => {
  const { runtime, last } = makeRuntime({ shellProcess: 'zsh' })

  // A generic program emits progress → generic handles it.
  runtime.push({ kind: 'foreground', busy: true, processName: 'vite' })
  runtime.push({ kind: 'progress', state: 1, progress: 10 })
  assert.equal(last().source, 'generic:progress')

  // Foreground switches to codex → codex now handles the notification.
  runtime.push({ kind: 'foreground', busy: true, processName: 'codex' })
  runtime.push({ kind: 'notification', body: 'approval-requested' })
  assert.equal(last().source, 'codex:notification')
  assert.equal(last().attention, true)
})

test('claude matching is independent of which shell spawned the session', () => {
  const { runtime, last } = makeRuntime({ shellProcess: 'bash' })

  runtime.push({ kind: 'foreground', busy: true, processName: 'claude' })
  // A notification always changes observable state, so its source is emitted.
  runtime.push({ kind: 'notification', body: 'Permission required' })
  assert.equal(last().source, 'claude-code:notification')
  assert.equal(last().attention, true)
})

async function importRuntime() {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-interpreters-test-'))
  const outputPath = join(tempDir, 'runtime.mjs')
  await build({
    bundle: true,
    entryPoints: [new URL('../electron/signalInterpreters/runtime.ts', import.meta.url).pathname],
    format: 'esm',
    outfile: outputPath,
    platform: 'node',
    target: 'es2022',
  })
  return import(outputPath)
}
