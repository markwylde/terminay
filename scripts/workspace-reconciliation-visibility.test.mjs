import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const store = await readFile(new URL('../src/shared/WorkspaceSnapshotStore.ts', import.meta.url), 'utf8')

test('the shared renderer visibly distinguishes stale, failed, and recovered workspace state', () => {
	assert.match(store, /subscribeStatus\(listener: WorkspaceStatusListener\)/u)
	assert.match(app, /store\.subscribeStatus\(\(status\) =>/u)
	assert.match(app, /Workspace synchronization is stale while Terminay securely resynchronizes it\./u)
	assert.match(app, /Workspace synchronization failed\. The last confirmed workspace remains visible/u)
	assert.match(app, /status\.state === 'current'[\s\S]*setWorkspaceSynchronizationError\(null\)/u)
	assert.match(app, /role="alert"[\s\S]*\{workspaceSynchronizationError\}/u)
})
