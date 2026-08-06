import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const store = await readFile(new URL('../src/shared/WorkspaceSnapshotStore.ts', import.meta.url), 'utf8')

test('terminal tab edits commit canonical panel presentation before updating Dockview', () => {
	const commit = app.indexOf('await workspaceStore.updatePanel({')
	const localTitle = app.indexOf('panel.api.setTitle(nextTitle);', commit)
	assert.ok(commit >= 0, 'terminal edit must update the server-owned panel')
	assert.ok(localTitle > commit, 'local Dockview presentation must follow the canonical update')
	assert.match(store, /async updatePanel\(request: PanelUpdateRequest[\s\S]*this\.workspace\.updatePanel\(request, options\)/u)
})
