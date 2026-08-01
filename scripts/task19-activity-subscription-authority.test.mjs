import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Task 19 activity projection requires the canonical live subscription transport', async () => {
	const source = await readFile('packages/client-core/src/activityClient.ts', 'utf8')
	assert.match(source, /subscribe: \(event: string, listener: \(event: ClientEvent<ActivityEvent>\) => void\)/u)
	assert.doesNotMatch(source, /subscribe\?: \(event: string, listener: \(event: ClientEvent<ActivityEvent>\) => void\)/u)
	assert.match(source, /activity subscriptions are required on this transport/u)
})
