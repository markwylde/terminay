import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile('src/shared/WorkspaceSnapshotStore.ts', 'utf8')

test('connection-owned workspace store subscribes before refresh and resnapshots retained gaps', () => {
  assert.match(source, /await this\.subscribeToChanges\(\)[\s\S]*await this\.loadInitialSnapshot\(\)/u)
  assert.match(source, /client\.subscribe\('workspace\.changed'\)/u)
  assert.match(source, /void this\.refresh\(\)\.catch\(\(\) => undefined\)/u)
  assert.match(source, /payload\.revision <= this\.known\.revision/u)
  assert.match(source, /subscription\.onResync\(\(\) => \{[\s\S]*this\.known = null[\s\S]*this\.refresh\(\)/u)
  assert.match(source, /private refreshPromise: Promise<ServerWorkspaceSnapshot> \| null = null/u)
  assert.match(source, /private refreshAgain = false/u)
  assert.match(source, /if \(this\.refreshPromise !== null\) \{[\s\S]*this\.refreshAgain = true[\s\S]*return this\.refreshPromise/u)
  assert.match(source, /if \(this\.refreshAgain && !this\.closed\) \{[\s\S]*void this\.refresh\(\)\.catch/u)
  assert.match(source, /payload.*serverId|isWorkspaceChange\(payload, this\.options\.serverId\)/u)
  assert.doesNotMatch(source, /if \(!this\.synchronizing\) await this\.refresh\(\)/u)
  assert.doesNotMatch(source, /setInterval|clearInterval|pollIntervalMs|startPolling/u)
})
