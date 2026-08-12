import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const authoritySource = await readFile(new URL('../electron/serverTerminalAuthority.ts', import.meta.url), 'utf8')

function handlerSource(channel) {
  const escaped = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`ipcMain\\.(?:handle|on)\\(\\s*'${escaped}'([\\s\\S]*?)(?=\\n\\s*ipcMain\\.|\\n\\s*app\\.|$)`))
  assert.ok(match, `${channel} handler exists`)
  return match[0]
}

test('terminal presentation metadata is no longer application IPC', () => {
	assert.doesNotMatch(source, /ipcMain\.(?:handle|on)\(\s*'terminal:update-remote-metadata'/u)
	const handler = handlerSource('desktop:terminal-presentation-host:update-metadata')
	assert.match(handler, /assertTrustedAppSender\(event\)/u)
	assert.match(handler, /const serverSession = serverTerminalAuthority\?\.get\(request\.sessionId\)/u)
	assert.match(
		handler,
		/serverSession\.projectId !== request\.projectId/u,
		'the narrow presentation bridge validates the canonical server project',
	)
})

test('terminal stream/read/write application IPC has been removed after server-client adoption', () => {
  for (const channel of ['terminal:get-cwd', 'terminal:get-buffer', 'terminal:write', 'terminal:resize', 'terminal:kill']) {
    assert.doesNotMatch(source, new RegExp(`ipcMain\\.(?:handle|on)\\(\\s*'${channel}'`), `${channel} has no Electron application handler`)
  }
})

test('embedded renderer MessagePort receives explicit management permissions', () => {
	const accept = authoritySource.match(/acceptRendererPort\([\s\S]*?\n\t\}\n\n\tasync create/u)?.[0]
	assert.ok(accept, 'renderer port authority exists')
	for (const permission of ['environments:read', 'environments:manage', 'workspace:write', 'extensions:read', 'extensions:manage']) {
		assert.match(accept, new RegExp(`['"]${permission}['"]`), permission)
	}
})
