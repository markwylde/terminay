import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [main, renderer, connector] = await Promise.all([
  readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/rendererRuntime.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/shared/rendererServerClient.ts', import.meta.url), 'utf8'),
])

test('only a trusted embedded renderer can request a fresh server MessagePort', () => {
  assert.match(main, /ipcMain\.handle\('server:connection:rehydrate'/u)
  assert.match(main, /assertTrustedAppSender\(event\)/u)
  assert.match(main, /payload\?\.serverId !== authority\.service\.serverId/u)
  assert.match(main, /replacement: true/u)
  assert.match(main, /authority\.acceptRendererPort\(/u)
})

test('renderer rehydrates once when the framed client closes and accepts only a marked replacement', () => {
  assert.match(renderer, /rehydratingServerIdRef/u)
  assert.match(renderer, /onTransportClosed: \(\) => requestRehydration\(message\.serverId\)/u)
  assert.match(renderer, /const isReplacement = \(message as/u)
  assert.match(renderer, /connectionRef\.current\?\.serverId === message\.serverId && !isReplacement/u)
  assert.match(connector, /onTransportClosed\?: \(\) => void/u)
  assert.match(connector, /change\.current\.state === 'closed' \|\| change\.current\.state === 'failed'/u)
  assert.match(connector, /if \(unexpectedlyClosed\) options\.onTransportClosed\?\.\(\)/u)
})
