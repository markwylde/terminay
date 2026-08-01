import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const mainPath = new URL('../electron/main.ts', import.meta.url)

test('Task 9 destroys renderer consumers without making renderer lifetime PTY lifetime', async () => {
  const source = await readFile(mainPath, 'utf8')

  assert.match(
    source,
    /function detachSessionsForWebContents\(webContentsId: number\): void \{[\s\S]*?serverTerminalAuthority\?\.detachRendererAll\(webContentsId\)/u,
  )
  assert.match(
    source,
    /app\.on\('web-contents-created',[\s\S]*?contents\.once\('destroyed',[\s\S]*?detachSessionsForWebContents\(contents\.id\)/u,
  )
  const detachStart = source.indexOf('function detachSessionsForWebContents(webContentsId: number): void {')
  const detachEnd = source.indexOf('\n\nlet isQuitting', detachStart)
  assert.ok(detachStart >= 0 && detachEnd > detachStart, 'renderer detach helper is present')
  const detachFunction = source.slice(detachStart, detachEnd)
  assert.doesNotMatch(detachFunction, /\.kill\(/u)
})
