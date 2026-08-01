import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSource = await readFile('src/App.tsx', 'utf8')
const activityControllerSource = await readFile('src/workspace/useTerminalActivityController.ts', 'utf8')
const activityClientSource = await readFile('packages/client-core/src/activityClient.ts', 'utf8')
const workspaceStoreSource = await readFile('src/shared/WorkspaceSnapshotStore.ts', 'utf8')

test('sidebar state cannot retrigger the connected activity snapshot effect', () => {
  assert.match(activityClientSource, /await this\.transport\.subscribe\(ACTIVITY_OPERATIONS\.event/u)
  assert.match(activityClientSource, /await this\.refresh\(\)/u)
  assert.doesNotMatch(activityClientSource, /setInterval|pollInterval|startPolling/u)

  const getPanelForSessionBlock = appSource.match(
    /const getPanelForSession = useCallback\([\s\S]*?findTerminalPanel\([\s\S]*?\);/u,
  )?.[0] ?? ''
  assert.ok(getPanelForSessionBlock.length > 0, 'expected stable getPanelForSession callback')
  assert.match(getPanelForSessionBlock, /\[\]/u)

  assert.match(
    activityControllerSource,
    /const applyEvaluation = useCallback\([\s\S]*?\n\t\t\[\],\n\t\);/u,
    'activity apply callback must not churn with sidebar state',
  )

  const activityEffect = appSource.match(
    /useEffect\(\(\) => \{\n\t\t\tif \(serverActivityClient === undefined\) \{[\s\S]*?void serverActivityClient\.refresh\(\)\.catch\(\(\) => undefined\);[\s\S]*?\}, \[[\s\S]*?\]\);/u,
  )?.[0] ?? ''
  assert.ok(activityEffect.length > 0, 'expected the connected activity refresh effect')
  assert.match(activityEffect, /\[\s*applyTerminalActivityEvaluation,\s*getPanelForSession,\s*project\.id,\s*serverActivityClient,\s*\]/u)
  assert.doesNotMatch(
    activityEffect,
    /sidebar|Explorer|isSidebar|navigation|workspaceSplit|resize|width/u,
    'sidebar presentation state must not be an activity.snapshot dependency',
  )

  assert.match(workspaceStoreSource, /client\.subscribe\('workspace\.changed'\)/u)
  assert.doesNotMatch(workspaceStoreSource, /setInterval|pollInterval|startPolling/u)
})
