import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { transform } from 'esbuild'

const { renderCodexBlock, hasCodexBlock, upsertCodexBlock, removeCodexBlock } =
  await importTransformed('../electron/mcpInstall/tomlEntry.ts')

const server = {
  command: '/Apps/Terminay',
  args: ['/Apps/dist-electron/mcpEntry.js'],
  env: { ELECTRON_RUN_AS_NODE: '1' },
}

test('renderCodexBlock renders header, command, args, and env', () => {
  const block = renderCodexBlock(server)
  assert.match(block, /^\[mcp_servers\.terminay\]$/m)
  assert.match(block, /command = "\/Apps\/Terminay"/)
  assert.match(block, /args = \["\/Apps\/dist-electron\/mcpEntry\.js"\]/)
  assert.match(block, /env = \{ ELECTRON_RUN_AS_NODE = "1" \}/)
})

test('renderCodexBlock escapes quotes and backslashes', () => {
  const block = renderCodexBlock({ command: 'C:\\a"b', args: [] })
  assert.match(block, /command = "C:\\\\a\\"b"/)
})

test('hasCodexBlock detects presence', () => {
  assert.equal(hasCodexBlock(renderCodexBlock(server)), true)
  assert.equal(hasCodexBlock('[other.table]\nx = 1\n'), false)
})

test('upsertCodexBlock appends to an empty file', () => {
  const out = upsertCodexBlock('', renderCodexBlock(server))
  assert.equal(hasCodexBlock(out), true)
})

test('upsertCodexBlock preserves other tables when appending', () => {
  const existing = '[mcp_servers.other]\ncommand = "x"\n'
  const out = upsertCodexBlock(existing, renderCodexBlock(server))
  assert.match(out, /\[mcp_servers\.other\]/)
  assert.match(out, /\[mcp_servers\.terminay\]/)
})

test('upsertCodexBlock replaces an existing terminay block in place', () => {
  const first = upsertCodexBlock('[a]\nk = 1\n', renderCodexBlock(server))
  const updated = upsertCodexBlock(
    first,
    renderCodexBlock({ ...server, command: '/new/Terminay' }),
  )
  assert.match(updated, /command = "\/new\/Terminay"/)
  assert.doesNotMatch(updated, /\/Apps\/Terminay/)
  // The unrelated table survives and the block is not duplicated.
  assert.match(updated, /\[a\]/)
  assert.equal(updated.match(/\[mcp_servers\.terminay\]/g).length, 1)
})

test('removeCodexBlock removes only the terminay block and is idempotent', () => {
  const withBlock = upsertCodexBlock('[a]\nk = 1\n', renderCodexBlock(server))
  const removed = removeCodexBlock(withBlock)
  assert.equal(hasCodexBlock(removed), false)
  assert.match(removed, /\[a\]/)
  assert.equal(removeCodexBlock(removed), removed)
})

async function importTransformed(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
  const transformed = await transform(source, {
    format: 'esm',
    loader: 'ts',
    platform: 'node',
    target: 'node20',
  })
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-codex-test-'))
  const outputPath = join(tempDir, `${relativePath.split('/').pop()}.mjs`)
  await writeFile(outputPath, transformed.code)
  return import(outputPath)
}
