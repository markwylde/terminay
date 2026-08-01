import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const authority = await readFile(new URL('../electron/serverTerminalAuthority.ts', import.meta.url), 'utf8')

function handler(name, nextName) {
  const start = main.indexOf(`ipcMain.handle('${name}'`)
  assert.ok(start >= 0, `${name} handler is registered`)
  const end = main.indexOf(`ipcMain.handle('${nextName}'`, start + 1)
  assert.ok(end >= 0, `${name} handler has a bounded body`)
  return main.slice(start, end)
}

test('authority session snapshots retain immutable launch metadata for host integrations', () => {
  assert.match(authority, /readonly shellPath: string \| null/u)
  assert.match(authority, /shellPath: options\.shellPath \?\? null/u)
  assert.match(authority, /shellPath: session\.shellPath/u)
})

test('server-owned recording start authorizes the attached renderer and uses authority metadata', () => {
  const source = handler('desktop:recording-service-host:start', 'desktop:recording-service-host:stop')

  assert.match(source, /assertTrustedAppSender\(event\)/u)
  assert.match(source, /serverTerminalAuthority\?\.get\(sessionId\)/u)
  assert.match(source, /session\.status !== 'running'/u)
  assert.match(source, /serverTerminalAuthority\.isRendererAttached\(session\.id, event\.sender\.id\)/u)
  assert.match(source, /resolveTerminalProcessCwd\(session\.pid\)/u)
  assert.match(source, /\?\? session\.cwd/u)
  assert.match(source, /projectId: session\.projectId/u)
  assert.match(source, /shell: session\.shellPath/u)
  assert.doesNotMatch(source, /readTerminalSettings\(\)/u)
})

test('server-owned recording stop authorizes the attached running session', () => {
  const source = handler('desktop:recording-service-host:stop', 'desktop:recording-service-host:list')

  assert.match(source, /assertTrustedAppSender\(event\)/u)
  assert.match(source, /serverTerminalAuthority\?\.get\(sessionId\)/u)
  assert.match(source, /session\.status !== 'running'/u)
  assert.match(source, /serverTerminalAuthority\.isRendererAttached\(session\.id, event\.sender\.id\)/u)
  assert.match(source, /recordingService\.finalize\(sessionId, null\)/u)
})
