import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Task 19 workspace deltas stay behind a canonical typed revision/cursor boundary', async () => {
	const facade = await readFile('packages/client-core/src/workspace.ts', 'utf8')
	assert.match(facade, /async delta\(revision: number, cursor: string/u)
	assert.match(facade, /cursor !== String\(revision\)/u)
	assert.match(facade, /workspace delta cursor is invalid/u)
	assert.match(facade, /value\.cursor !== String\(value\.revision\)/u)
	assert.doesNotMatch(facade, /async command\(command: WorkspaceCommandDto/u)
})
