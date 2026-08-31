import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Task 19 shared workspace selection keeps active panel local', async () => {
	const [controller, facade] = await Promise.all([
		readFile('src/shared/useWorkspaceSelectionController.ts', 'utf8'),
		readFile('packages/client-core/src/workspace.ts', 'utf8'),
	])

	assert.doesNotMatch(controller, /workspaceSnapshotStore\.activatePanel\(/u)
	assert.doesNotMatch(controller, /\.command\(\{ type: ['"]panel\.activate/u)
	assert.doesNotMatch(controller, /type: ['"]project\.activate/u)
	assert.match(facade, /async activatePanel\(\s*request: PanelActivationRequest/u)
	assert.doesNotMatch(facade, /async command\(command: WorkspaceCommandDto/u)
})
