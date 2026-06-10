import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'
import headless from '@xterm/headless'

const { Terminal } = headless

const { attachSignalParser } = await importParser()

/**
 * Drives a fresh headless terminal + parser, writes every chunk, and resolves
 * with the list of protocol signals the parser emitted.
 */
async function collectSignals(chunks) {
  const terminal = new Terminal({ cols: 80, rows: 24, scrollback: 0, allowProposedApi: true })
  const signals = []
  const dispose = attachSignalParser(terminal, (signal) => signals.push(signal))

  await new Promise((resolve) => {
    let remaining = chunks.length
    if (remaining === 0) {
      resolve()
      return
    }
    for (const chunk of chunks) {
      terminal.write(chunk, () => {
        remaining -= 1
        if (remaining === 0) {
          resolve()
        }
      })
    }
  })

  dispose()
  terminal.dispose()
  return signals
}

const BEL = '\x07'
const ST = '\x1b\\'
const OSC = '\x1b]'

test('parses OSC 9;4 progress with both BEL and ST terminators', async () => {
  const signals = await collectSignals([
    `${OSC}9;4;3;${BEL}`,
    `${OSC}9;4;1;50${ST}`,
    `${OSC}9;4;0;${BEL}`,
  ])

  assert.deepEqual(signals, [
    { kind: 'progress', state: 3 },
    { kind: 'progress', state: 1, progress: 50 },
    { kind: 'progress', state: 0 },
  ])
})

test('treats OSC 9 non-progress payloads as notifications', async () => {
  const signals = await collectSignals([`${OSC}9;Build finished${BEL}`])
  assert.deepEqual(signals, [{ kind: 'notification', body: 'Build finished' }])
})

test('parses OSC 133 command lifecycle including exit code', async () => {
  const signals = await collectSignals([
    `${OSC}133;A${BEL}`,
    `${OSC}133;B${BEL}`,
    `${OSC}133;C${BEL}`,
    `${OSC}133;D;0${BEL}`,
  ])

  assert.deepEqual(signals, [
    { kind: 'command', phase: 'prompt' },
    { kind: 'command', phase: 'input' },
    { kind: 'command', phase: 'executing' },
    { kind: 'command', phase: 'finished', exitCode: 0 },
  ])
})

test('parses OSC 633 as an alias of OSC 133 and ignores E/P subcommands', async () => {
  const signals = await collectSignals([
    `${OSC}633;C${BEL}`,
    `${OSC}633;E;ls -la${BEL}`,
    `${OSC}633;P;Cwd=/tmp${BEL}`,
    `${OSC}633;D;1${BEL}`,
  ])

  assert.deepEqual(signals, [
    { kind: 'command', phase: 'executing' },
    { kind: 'command', phase: 'finished', exitCode: 1 },
  ])
})

test('parses OSC 777 notify sequences', async () => {
  const signals = await collectSignals([`${OSC}777;notify;Title;Body text${BEL}`])
  assert.deepEqual(signals, [{ kind: 'notification', title: 'Title', body: 'Body text' }])
})

test('surfaces the terminal bell', async () => {
  const signals = await collectSignals([BEL])
  assert.deepEqual(signals, [{ kind: 'bell' }])
})

test('ignores malformed progress payloads (out-of-range / non-numeric state)', async () => {
  const signals = await collectSignals([
    `${OSC}9;4;9;${BEL}`, // state 9 is out of range
    `${OSC}9;4;x;${BEL}`, // non-numeric state
  ])

  // Both fall back to being treated as notifications, never progress.
  assert.equal(signals.every((s) => s.kind === 'notification'), true)
})

test('command finished with no exit code omits exitCode', async () => {
  const signals = await collectSignals([`${OSC}133;D${BEL}`])
  assert.deepEqual(signals, [{ kind: 'command', phase: 'finished' }])
})

test('handles a sequence split across write chunks', async () => {
  const signals = await collectSignals([`${OSC}9;4;`, `3;${BEL}`])
  assert.deepEqual(signals, [{ kind: 'progress', state: 3 }])
})

async function importParser() {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-signal-parser-test-'))
  const outputPath = join(tempDir, 'parser.mjs')
  await build({
    bundle: true,
    entryPoints: [new URL('../electron/terminalSignalParser.ts', import.meta.url).pathname],
    format: 'esm',
    outfile: outputPath,
    platform: 'node',
    target: 'es2022',
    external: ['@xterm/headless'],
  })
  return import(outputPath)
}
