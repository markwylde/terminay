import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

test('desktop build packages the server-owned renderer-free MCP entry', async () => {
  const entryPath = resolve('dist-electron/serverMcpEntry.js')
  await access(entryPath)
  const source = await readFile(entryPath, 'utf8')
  assert.doesNotMatch(source, /(?:from|require\()\s*["']electron["']/u)
  assert.match(source, /\.\/stdio-[A-Za-z0-9_-]+\.js/u)
  assert.match(source, /TERMINAY_CONTROL_TOKEN/u)
  const chunkNames = (await readdir(resolve('dist-electron'))).filter((name) => name.startsWith('stdio-') && name.endsWith('.js'))
  assert.equal(chunkNames.length, 1)
  const chunk = await readFile(resolve('dist-electron', chunkNames[0]), 'utf8')
  assert.doesNotMatch(chunk, /(?:from|require\()\s*["']electron["']/u)
})
