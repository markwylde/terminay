import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8')

test('preload captures the server port before React subscribes', () => {
  const capture = source.indexOf("ipcRenderer.on('server:connection'")
  const bridge = source.indexOf('contextBridge.exposeInMainWorld')
  assert.ok(capture >= 0)
  assert.ok(bridge > capture)
  assert.match(source, /pendingServerConnection\s*=\s*replacement\s*\?/u)
  assert.match(source, /queueMicrotask\(\(\)\s*=>/u)
  assert.match(source, /serverConnectionListeners\.add\(listener\)/u)
})

test('preload replaces a port only for an explicit renderer rehydration', () => {
  assert.match(source, /const replacement = message\.replacement === true/u)
  assert.match(source, /serverPorts\.has\(connection\.serverId\) && !replacement/u)
  assert.match(source, /serverPorts\.get\(connection\.serverId\)\?\.close\(\)/u)
  assert.match(source, /requestServerConnection: \(serverId: string\)/u)
  assert.match(source, /server:connection:rehydrate/u)
})

test('preload removes only the port generation which actually closed', () => {
  assert.match(source, /const notifyPortClosed = \(\) =>/u)
  assert.match(source, /serverPorts\.get\(connection\.serverId\) !== port/u)
  assert.match(source, /serverPorts\.delete\(connection\.serverId\)/u)
  assert.match(source, /\.onclose = notifyPortClosed/u)
})

test('preload structurally normalizes renderer bytes before forwarding client frames', () => {
  const sendStart = source.indexOf('sendServerFrame: (serverId: string, frame: Uint8Array) =>')
  const sendEnd = source.indexOf('onServerFrame:', sendStart)
  assert.ok(sendStart >= 0 && sendEnd > sendStart)
  const send = source.slice(sendStart, sendEnd)
  assert.match(send, /const bytes = asServerFrame\(frame\)/u)
  assert.match(send, /frame: bytes/u)
  assert.doesNotMatch(send, /frame instanceof Uint8Array/u)
})
