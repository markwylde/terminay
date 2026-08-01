import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Task 19 settings client cannot silently retain a stale host-side projection', async () => {
	const [client, bridge] = await Promise.all([
		readFile('packages/client-core/src/settings.ts', 'utf8'),
		readFile('src/services/settings/legacySettingsClient.ts', 'utf8'),
	])

	assert.match(client, /subscribe\(event: string, listener: \(payload: JsonValue\) => void\): \(\) => void;/u)
	assert.doesNotMatch(client, /subscribe\?\./u)
	assert.match(client, /return this\.transport\.subscribe\(SETTINGS_EVENTS\.changed, listener\)/u)
	assert.match(bridge, /subscribe\(event: string, listener: \(payload: JsonValue\) => void\): \(\) => void/u)
})
