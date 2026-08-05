import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const authority = await readFile(new URL('../electron/serverTerminalAuthority.ts', import.meta.url), 'utf8')
const serverAdapter = await readFile(new URL('../electron/agentStatus/serverAdapter.ts', import.meta.url), 'utf8')

test('normal embedded Desktop wiring has one server-owned agent authority', () => {
	assert.match(main, /serverAgents\.setIntegrationEnabled\(enabled\)/u)
	assert.doesNotMatch(main, /legacyAgentStatusService|AgentStatusService|agentDriverRegistry/u)
	assert.doesNotMatch(main, /agent-status:(?:get-snapshot|acknowledge|acknowledge-terminal|snapshot)|registerAgentStatusIpcHandlers/u)
	assert.match(authority, /agentStatusIpcAdapter\(\)/u)
	assert.match(authority, /createServerAgentStatusIpcAdapter\(\{[\s\S]{0,120}?agents:\s*this\.agents/u)
	assert.match(serverAdapter, /agents\.acknowledge\(identity, entryId\)/u)
	assert.doesNotMatch(serverAdapter, /ipcMain|IpcMain|ipcRenderer/u)
})

test('the embedded host no longer retains a legacy PTY-host terminal authority', () => {
	assert.doesNotMatch(main, /terminalSessions|createPtySession|sendToPtyHost|getPtyHostPath|PtyHostMessage/u)
	assert.doesNotMatch(main, /fork\(|type PtyHostMessage|interface TerminalSession/u)
	assert.doesNotMatch(main, /terminal:wait-for-inactivity[\s\S]*?requestId/u)
})

test('server-owned inactivity delegates to TerminalService rather than inventing an Electron timer', () => {
	assert.match(authority, /async waitForInactivity\(\s*id: string,\s*durationMs: number/u)
	assert.match(authority, /this\.service\.waitForInactivity\(id, durationMs, \{ authorization \}\)/u)
	assert.match(
		main,
		/await serverTerminalAuthority\.waitForInactivity\(\s*session\.id,\s*request\.durationMs,\s*\)/u,
	)
	assert.doesNotMatch(main, /if \(serverTerminalAuthority\?\.get\(id\)\) \{\s*await new Promise/u)
})

test('test-only terminal creation has no PTY-host fallback entry point', () => {
	const start = main.indexOf("'test:create-server-terminal'")
	const end = main.indexOf("'test:get-mcp-control-environment'", start)
	const handler = main.slice(start, end === -1 ? undefined : end)
	assert.ok(start >= 0, 'the test-only terminal creation handler is registered')
	assert.match(handler, /if \(!serverTerminalAuthority\)\s*throw new Error\('embedded server is unavailable'\)/u)
	assert.match(handler, /createServerOwnedTerminalSession\(/u)
	assert.doesNotMatch(handler, /createPtySession|ptyHost/u)
})

test('the test MCP bridge resolves a server-owned session before returning its existing capability', () => {
	const handlerStart = main.indexOf("'test:get-mcp-control-environment'")
	assert.ok(handlerStart >= 0, 'the test MCP bridge is registered')
	const handlerEnd = main.indexOf("'test:send-app-command'", handlerStart)
	const handler = main.slice(handlerStart, handlerEnd === -1 ? undefined : handlerEnd)
	assert.match(handler, /assertTrustedAppSender\(event\)/u)
	assert.match(handler, /serverTerminalAuthority\?\.get\(terminalSessionId\)/u)
	assert.doesNotMatch(handler, /terminalSessions/u)
	assert.match(
		handler,
		/const token =[\s\S]{0,120}?controlTokensBySession\.get\(terminalSessionId\) \?\?[\s\S]{0,120}?registerControlToken\(terminalSessionId, event\.sender\.id\)/u,
	)
	assert.doesNotMatch(handler, /The requested terminal has no MCP capability/u)
})
