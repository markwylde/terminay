import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile('src/workspace/useFileExplorerController.ts', 'utf8')
const gitFilesystemScopeSource = await readFile('src/workspace/gitFilesystemScope.ts', 'utf8')
const worktreesPanelSource = await readFile('src/components/git-panel/WorktreesPanel.tsx', 'utf8')

test('worktree presentation reserves clean for worktrees without committed or working changes', () => {
  assert.match(worktreesPanelSource, /hasUnmergedOrUncommittedWork \? \(/u)
  assert.match(worktreesPanelSource, />changed<\/span>/u)
})

test('Git tree filesystem mutations switch to the owning worktree before Explorer commands', () => {
  assert.match(gitFilesystemScopeSource, /export function owningWorktreeForPath/u)
  assert.match(gitFilesystemScopeSource, /export function gitFilesystemActionWorktreeRoot/u)
  assert.match(source, /queueOwningWorktreeAction/u)
  assert.match(source, /kind: 'delete'/u)
  assert.match(source, /toContainedProjectRelativePath\(path, project\.rootFolder\)/u)
  assert.match(
    source,
    /onUpdateProject\(project\.id, \{ rootFolder: worktreeRoot \}\)/u,
  )
})

test('caught worktree removal failures reach bounded renderer diagnostics', () => {
  const handler = source.match(/const handleDeleteWorktree = useCallback\([\s\S]*?\n\t\);/u)?.[0] ?? ''
  assert.ok(handler.length > 0, 'expected the worktree deletion handler')
  assert.match(
    handler,
    /catch \(error\) \{\s*console\.error\('\[terminay\] git\.worktree\.remove failed', error\);\s*onOperationError\('Git', error\);/u,
  )
  assert.doesNotMatch(
    handler,
    /console\.error\([^\n]*(?:worktree\.path|worktree\.name|worktree\.head|reference)/u,
    'diagnostics must not log worktree identifiers or paths',
  )
})
const gitServiceSource = await readFile('packages/server-core/src/gitService/service.ts', 'utf8')
const serverCompositionSource = await readFile('packages/server-core/src/composition.ts', 'utf8')
const serverConnectionSource = await readFile('packages/server-core/src/connection.ts', 'utf8')
const gitClientSource = await readFile('packages/client-core/src/gitClient.ts', 'utf8')

test('file explorer git status is stable across transient refresh churn', () => {
  assert.match(source, /function sameGitStatuses/u)
  assert.match(source, /function sameWorktreePanelStatus/u)
  assert.doesNotMatch(source, /GIT_STATUS_POLL_INTERVAL_MS/u)
  assert.doesNotMatch(source, /setInterval\(\s*\(\) => void refreshGitStatuses/u)
  assert.doesNotMatch(source, /window\.clearInterval\(interval\)/u)
  assert.doesNotMatch(source, /window\.terminayGitWorktreeHost/u)
  assert.doesNotMatch(source, /host\.getStatuses\(rootFolder\)/u)
  assert.doesNotMatch(source, /host\.getWorktrees\(rootFolder\)/u)
  assert.match(source, /EMPTY_WORKTREE_PANEL_STATUS/u)
  assert.match(source, /GIT_UNAVAILABLE_WORKTREE_PANEL_STATUS/u)
  assert.match(source, /function loadGitWorkspaceFromServer/u)
  assert.match(source, /loadServerGitWorkspace\(gitClient, project\.id\)/u)
  assert.doesNotMatch(source, /withLocalGitFallbackDeadline/u)
  assert.doesNotMatch(source, /ROOT_CHANGE_GIT_REFRESH_RETRY_COUNT/u)
  assert.doesNotMatch(source, /remainingRootChangeRetries/u)
  assert.doesNotMatch(source, /const refreshGitStatuses = useCallback/u)
  assert.doesNotMatch(source, /addEventListener\('focus',[^\n]*Git/u)
  assert.doesNotMatch(source, /visibilitychange[\s\S]*refreshGitStatuses/u)
  assert.doesNotMatch(source, /loadLocalGitWorkspaceIfAvailable/u)
  assert.doesNotMatch(source, /projection = localProjection/u)
  assert.match(source, /setGitStatuses\(\(current\) =>[\s\S]*sameGitStatuses\(current, projection\.statuses\)[\s\S]*\? current[\s\S]*: projection\.statuses/u)
  assert.match(source, /setWorktreePanelStatus\(\(current\) =>[\s\S]*sameWorktreePanelStatus\(current, projection\.worktrees\)[\s\S]*\? current[\s\S]*: projection\.worktrees/u)
  assert.match(source, /const projection = await loadGitWorkspaceFromServer\(gitClient, \{\s*id: project\.id,\s*rootFolder: targetRootFolder,\s*\}\)/u)
  assert.match(source, /const targetRootFolder = markAsCurrent\s*\? rootFolder\s*: latestGitRootRef\.current;/u)
  const refreshPrefix = source.match(/const refreshGitStatusesForRoot = useCallback\(async \([\s\S]*?gitRefreshRequestIdRef\.current \+= 1/u)?.[0] ?? ''
  assert.ok(refreshPrefix.length > 0, 'expected Git refresh request id increment')
  assert.match(refreshPrefix, /const targetRootFolder = markAsCurrent[\s\S]*if \(!targetRootFolder\) \{[\s\S]*gitRefreshRequestIdRef\.current \+= 1/u)
  assert.match(source, /rootFolder: targetRootFolder/u)
  assert.match(source, /latestGitRootRef\.current !== targetRootFolder/u)
  assert.match(source, /\.subscribeStatusChanges\(/u)
  assert.match(source, /unavailableWatchFallbacksRef/u)
  assert.match(source, /!unavailableWatchFallbacksRef\.current\.has\(path\)/u)
  assert.match(source, /unavailableWatchFallbacksRef\.current\.add\(path\)/u)

  const catchBlock = source.match(/catch \{[\s\S]*?Preserve the last good projection[\s\S]*?\} finally/u)?.[0] ?? ''
  assert.doesNotMatch(catchBlock, /setGitStatuses\(\{\}\)|setWorktreePanelStatus\(null\)/u)
  assert.doesNotMatch(source, /setGitStatuses\(\{\}\)|setWorktreePanelStatus\(null\)/u)

  const reloadEffect = source.match(/setDirectoryChildren\(\{\}\);[\s\S]*?if \(project\.rootFolder\) \{[\s\S]*?void refreshGitStatusesForRoot\([\s\S]*?\);[\s\S]*?\}/u)?.[0] ?? ''
  assert.ok(reloadEffect.length > 0, 'expected the root reload effect to be present')
  assert.doesNotMatch(reloadEffect, /setGitStatuses\(\{\}\)|setWorktreePanelStatus\(null\)/u)
})

test('server owns Git status polling and event delivery', () => {
  assert.match(gitServiceSource, /statusPollIntervalMs = options\.statusPollIntervalMs \?\? 10_000/u)
  assert.match(gitServiceSource, /this\.startStatusPoll\(projectId\)/u)
  assert.match(gitServiceSource, /void this\.worktrees\(\{ projectId \}\)[\s\S]*finally\(schedule\)/u)
  assert.match(gitServiceSource, /this\.publishStatusChange\(status\)/u)
  assert.match(gitServiceSource, /this\.publishStatusChange\(\{\s*projectId: target\.projectId/u)
  assert.match(serverCompositionSource, /eventJournal\.append\(event\.type, event as unknown as JsonValue\)/u)
  assert.match(gitClientSource, /subscribeStatusChanges\(/u)
  assert.match(gitClientSource, /subscribeClientEvents\("git\.status\.changed"/u)
})

test('server replies with a protocol error instead of hanging oversized projections', () => {
  assert.match(serverConnectionSource, /catch \(error\) \{\s*await this\.send\(\{ type: "query_result"[\s\S]*responseFailureError\(error\)/u)
  assert.match(serverConnectionSource, /catch \(error\) \{\s*await this\.send\(\{ type: "command_result"[\s\S]*responseFailureError\(error\)/u)
  assert.match(serverConnectionSource, /protocolError\("resource", "response exceeded protocol limits"/u)
})

test('worktree panel ignores equivalent Git projection object churn', () => {
  assert.match(worktreesPanelSource, /const worktreePathSignature\s*=/u)
  assert.match(
    worktreesPanelSource,
    /status\.worktrees\.map\(\(worktree\) => worktree\.path\)\.join\('\\n'\)/u,
  )
  assert.match(
    worktreesPanelSource,
    /\}, \[status\?\.repoRoot, worktreePathSignature\]\);/u,
  )
  assert.doesNotMatch(
    worktreesPanelSource,
    /\}, \[status\]\);/u,
    'Worktree collapse bookkeeping must not reset on equivalent status object identity churn.',
  )
})
