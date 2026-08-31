import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [source, store, app, splitLayoutCss] = await Promise.all([
  readFile('src/workspace/useProjectCollection.ts', 'utf8'),
  readFile('src/shared/WorkspaceSnapshotStore.ts', 'utf8'),
  readFile('src/App.tsx', 'utf8'),
  readFile('src/shared/WorkspaceSplitLayout.css', 'utf8'),
])

test('project collection accepts a canonical root and never discovers host filesystem authority', () => {
  assert.match(source, /defaultProjectRoot\?: string/u)
  assert.match(source, /defaultProjectRoot/u)
  assert.doesNotMatch(source, /terminayFileExplorerHost|getHomePath/u)
})

test('connected project tabs reconcile canonical server identity and root', () => {
  assert.match(source, /workspaceSnapshotStore\.subscribe/u)
  assert.match(source, /snapshot\.viewOrder\.flatMap/u)
  assert.match(source, /id: serverProject\.id/u)
  assert.match(source, /title: serverProject\.name/u)
  assert.match(source, /rootFolder: serverProject\.root/u)
  assert.match(source, /color: serverProject\.color \?\? base\.color/u)
  assert.match(source, /emoji: serverProject\.icon \?\? base\.emoji/u)
  assert.match(app, /workspaceSnapshotStore: terminalClientContext\?\.workspaceSnapshotStore/u)
})

test('connected add-project mutates the canonical workspace authority', () => {
	assert.match(source, /workspaceSnapshotStore\s*\n\s*\.createProject\(/u)
	assert.match(store, /this\.workspace\.createProject\(request, options\)/u)
	assert.match(store, /this\.workspace\.closeProject\(projectId, options\)/u)
	assert.match(source, /workspaceSnapshotStore\s*\n\s*\.createProject\([\s\S]*return;[\s\S]*setProjects\(\(current\)/u)
	assert.match(source, /workspaceSnapshotStore\s*\n\s*\.closeProject\(projectId\)/u)
	assert.match(source, /defaultProjectRoot\.trim\(\)\.length > 0 \? defaultProjectRoot : '\.'/u)
})

test('connected project tab activation stays local to the presentation', () => {
  assert.match(source, /const activateProject = useCallback\(\s*\(projectId: string\) => \{/u)
  assert.doesNotMatch(source, /workspaceSnapshotStore\.activateProject\(\{ projectId \}\)/u)
  assert.doesNotMatch(source, /activateProject\(\{\s*projectId: nextId\s*\}\)/u)
  assert.doesNotMatch(source, /\(view\?\.activeProjectId \?\?/u)
  assert.match(app, /onActivate=\{activateDisplayedProject\}/u)
  assert.match(app, /activateProject\(projectId\)/u)
  assert.doesNotMatch(app, /onActivate=\{setActiveProjectId\}/u)
})

test('connected project collection never creates a fake local project while hydrating', () => {
  assert.match(source, /hasServerWorkspace && initialServerSnapshot === null\) return \[\]/u)
  assert.match(source, /if \(hasServerWorkspace\) return \[\]/u)
  assert.match(source, /canAddProject:/u)
  assert.match(app, /disabled=\{!canAddProject\}/u)
  assert.match(app, /Loading workspace\.\.\./u)
})

test('workspace snapshot cleanup suppresses expected disconnect unsubscribe failures', () => {
  assert.match(store, /this\.unsubscribeEvents\?\.\(\)\.catch/u)
  assert.match(store, /isExpectedDisconnect\(error\)/u)
})

test('hidden workspace navigation gives content the visible grid column', () => {
  assert.match(
    splitLayoutCss,
    /\.workspace-split-layout\[data-navigation-visible="false"\]\s*[\r\n\t ]*\.workspace-split-layout__content\s*\{[\s\S]*grid-column:\s*1;/u,
  )
})

test('web shell does not reserve native macOS window-control padding', () => {
  assert.match(app, /hasNativeWindowControls\s*=\s*typeof window\.terminayWindowLifecycleHost !== 'undefined'/u)
  assert.match(app, /isMac && hasNativeWindowControls \? ' app-shell--macos'/u)
})

test('canonical project root reaches browser explorer and Git consumers', () => {
  assert.match(app, /rootPath=\{project\.rootFolder\}/u)
  assert.match(app, /projectRoot=\{project\.rootFolder\}/u)
  assert.match(app, /gitClient: terminalClientContext\?\.gitClient/u)
  assert.match(app, /<WorktreesPanel/u)
})
