import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

test('Task 19 macro events require the canonical server subscription', async () => {
	const source = await readFile('packages/client-core/src/macros.ts', 'utf8')
	assert.match(source, /readonly subscribe: \(event: string, listener: \(payload: JsonValue\) => void\) => \(\) => void/u)
	assert.match(source, /macro change subscription is unavailable/u)
	assert.match(source, /macro run subscription is unavailable/u)
	assert.doesNotMatch(source, /subscribe\?\./u)
	assert.doesNotMatch(source, /\?\? \(\(\) => undefined\)/u)
})
