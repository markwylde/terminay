import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Task 19 shared connected contexts do not retain a partial compatibility projection', async () => {
  const source = await readFile('src/shared/rendererServerClient.ts', 'utf8')

  assert.match(source, /trackedPhase\(\s*options,\s*'activity subscription',\s*withTimeout\(\s*candidateActivityClient\.subscribe\(\)/u)
  assert.match(source, /trackedPhase\(\s*options,\s*'agent-status subscription',\s*withTimeout\(\s*candidateAgentStatusClient\.subscribe\(\)/u)
  assert.match(source, /activityClient,\s*agentStatusClient,/u)
  assert.doesNotMatch(source, /activityClient = undefined/u)
  assert.doesNotMatch(source, /agentStatusClient = undefined/u)
  assert.doesNotMatch(source, /older Desktop build may not expose activity/u)
})
