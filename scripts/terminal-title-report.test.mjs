import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import headless from '@xterm/headless'

const { Terminal } = headless

// A program may set its terminal's title to any text. If the terminal answered
// a title query, that text would arrive on the program's input as if typed.
// xterm answers only when `windowOptions.getWinTitle` is granted; nothing
// grants it.

const emulators = [
  'src/components/TerminalPanel.tsx',
  'src/components/SettingsWindow.tsx',
  'src/components/RecordingsWindow.tsx',
  'src/workspace/automations/ExitedAutomationTerminalView.tsx',
  'packages/server-core/src/terminalService/presentationCheckpoint.ts',
]

test('no terminal emulator is granted xterm window options', async () => {
  for (const path of emulators) {
    const source = await readFile(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')
    assert.match(source, /new Terminal\(/u, `${path} no longer constructs a terminal`)
    assert.doesNotMatch(source, /windowOptions|getWinTitle|getIconTitle/u, path)
  }
})

test('a title query after a title sequence is answered with nothing', async () => {
  const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true })
  const replies = []
  terminal.onData((data) => replies.push(data))
  await new Promise((resolve) => terminal.write('\x1b]2;rm -rf ~\x07\x1b[21t\x1b[20t', resolve))
  assert.deepEqual(replies, [])
  terminal.dispose()
})
