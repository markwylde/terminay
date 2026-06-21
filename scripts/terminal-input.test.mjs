import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { transform } from 'esbuild'

const {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
  formatBracketedPaste,
  formatRunCommandInput,
} = await importTransformed('../src/terminalInput.ts')

test('formatRunCommandInput leaves one-line commands unchanged', () => {
  assert.equal(formatRunCommandInput('docker ps'), 'docker ps')
})

test('formatRunCommandInput wraps newline commands in bracketed paste', () => {
  const command = "set -e\nprintf 'ok\\n'"
  assert.equal(
    formatRunCommandInput(command),
    `${BRACKETED_PASTE_START}${command}${BRACKETED_PASTE_END}`,
  )
})

test('formatRunCommandInput wraps CRLF commands in bracketed paste', () => {
  const command = 'set -e\r\nid'
  assert.equal(formatRunCommandInput(command), formatBracketedPaste(command))
})

test('formatRunCommandInput preserves trailing newlines inside the paste', () => {
  const command = 'id\n'
  assert.equal(formatRunCommandInput(command), formatBracketedPaste(command))
})

async function importTransformed(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
  const transformed = await transform(source, {
    format: 'esm',
    loader: 'ts',
    platform: 'node',
    target: 'node20',
  })
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-terminal-input-test-'))
  const outputPath = join(tempDir, `${relativePath.split('/').pop()}.mjs`)
  await writeFile(outputPath, transformed.code)
  return import(outputPath)
}
