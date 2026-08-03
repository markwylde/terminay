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

test('workspace snapshot reconciliation updates renamed tabs and removes closed tabs', () => {
	assert.match(app, /reconcileServerPanels: \(panels: readonly ServerWorkspacePanel\[\]\) => void/u)
	assert.match(app, /canonical\.title !== undefined && panel\.title !== canonical\.title\)[\s\S]*panel\.api\.setTitle\(canonical\.title\)/u)
	assert.match(app, /canonical === undefined\)[\s\S]*api\.removePanel\(panel\)/u)
	assert.match(app, /const canonicalTerminalPanels = Object\.values\(snapshot\.panels\)\.filter\([\s\S]*panel\.type === 'terminal'[\s\S]*workspace\.reconcileServerPanels\(canonicalTerminalPanels\)/u)
})
