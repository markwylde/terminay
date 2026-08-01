import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Task 19 shared workspace selection does not construct raw workspace commands', async () => {
	const [controller, facade] = await Promise.all([
		readFile('src/shared/useWorkspaceSelectionController.ts', 'utf8'),
		readFile('packages/client-core/src/workspace.ts', 'utf8'),
	])

	assert.match(controller, /\.activatePanel\(\{ projectId: panel\.projectId, panelId: panel\.id \}\)/u)
	assert.doesNotMatch(controller, /\.command\(\{ type: ['"]panel\.activate/u)
	assert.match(facade, /async activatePanel\(request: PanelActivationRequest/u)
	assert.doesNotMatch(facade, /async command\(command: WorkspaceCommandDto/u)
})
