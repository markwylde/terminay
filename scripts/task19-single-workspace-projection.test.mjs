import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Task 19 shared workspace selection uses only the connection-owned snapshot projection', async () => {
	const [controller, store, app] = await Promise.all([
		readFile('src/shared/useWorkspaceSelectionController.ts', 'utf8'),
		readFile('src/shared/WorkspaceSnapshotStore.ts', 'utf8'),
		readFile('src/App.tsx', 'utf8'),
	])

	assert.match(controller, /useWorkspaceSelectionController\(workspaceSnapshotStore: WorkspaceSnapshotStore\)/u)
	assert.doesNotMatch(controller, /workspaceSnapshotStore\.activatePanel\(/u)
	assert.doesNotMatch(controller, /new WorkspaceClient\(/u)
	assert.doesNotMatch(controller, /workspace\.snapshot\(/u)
	assert.doesNotMatch(controller, /window\.setInterval/u)
	assert.match(store, /async activatePanel\(request: PanelActivationRequest/u)
	assert.match(app, /terminalClientContext\?\.workspaceSnapshotStore/u)
	assert.doesNotMatch(app, /new WorkspaceClient\(/u)
})
