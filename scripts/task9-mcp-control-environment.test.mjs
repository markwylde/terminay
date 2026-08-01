import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')

function handlerBody(source) {
  const start = source.indexOf("'test:get-mcp-control-environment'")
  assert.ok(start >= 0, 'test control-environment IPC handler is registered')
  const end = source.indexOf("'test:send-app-command'", start)
  assert.ok(end >= 0, 'test control-environment IPC handler has a bounded body')
  return source.slice(start, end)
}

test('MCP test bridge resolves the token already issued to a server-owned terminal', () => {
  const handler = handlerBody(main)

  assert.match(handler, /assertTrustedAppSender\(event\)/u)
  assert.match(handler, /const serverSession = serverTerminalAuthority\?\.get\(terminalSessionId\)/u)
  assert.match(handler, /serverSession\?\.status !== 'running'/u)
  assert.doesNotMatch(handler, /terminalSessions/u)
  assert.match(handler, /controlTokensBySession\.get\(terminalSessionId\)/u)
  assert.match(handler, /socketPath: getControlSocketPath\(\)/u)
  assert.match(handler, /token,/u)
})

test('server-owned terminal creation and authoritative exit own the control token lifecycle', () => {
  assert.match(main, /const token = registerControlToken\(id, webContentsId\)/u)
  assert.match(main, /removeControlToken\(event\.sessionId\)/u)
  assert.match(main, /const session = serverTerminalAuthority\?\.get\(record\.sessionId\)/u)
})
