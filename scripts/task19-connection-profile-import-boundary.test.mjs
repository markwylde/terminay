import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Task 19 profile migration imports only the host-local connection DTO', async () => {
	const source = await readFile('packages/client-core/src/connections.ts', 'utf8')
	assert.match(source, /PROFILE_IMPORT_KEYS/u)
	assert.match(source, /unsupported compatibility data/u)
	assert.match(source, /"id", "serverId", "label", "origin", "status", "createdAt"/u)
	assert.doesNotMatch(source, /"workspaceSnapshot"\s*,\s*"terminalSessions"/u)
})
