import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Task 19 shared workspace movement stays behind the typed canonical facade', async () => {
	const [facade, sharedSources] = await Promise.all([
		readFile('packages/client-core/src/workspace.ts', 'utf8'),
		Promise.all([
			readFile('src/shared/useWorkspaceSelectionController.ts', 'utf8'),
			readFile('src/shared/WorkspaceSnapshotStore.ts', 'utf8'),
			readFile('src/App.tsx', 'utf8'),
		]).then((sources) => sources.join('\n')),
	])

	assert.match(facade, /async moveProject\(\s*request: ProjectMoveRequest/u)
	assert.match(facade, /result\.projectId !== request\.projectId/u)
	assert.match(facade, /project move response identity is invalid/u)
	assert.doesNotMatch(sharedSources, /\.command\(['"]project\.move['"]/u)
	assert.doesNotMatch(sharedSources, /type:\s*['"]project\.move['"]/u)
})
