import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Task 19 legacy AI metadata adapter does not manufacture a second authority', async () => {
	const source = await readFile('src/services/ai/legacyAiTabMetadataClient.ts', 'utf8')

	assert.match(source, /const capability = captureLegacyAiTabMetadataCapability\(api\)/u)
	assert.match(source, /await capability\.generateAiTabMetadata\(request\)/u)
	assert.doesNotMatch(source, /await api\.generateAiTabMetadata\(request\)/u)
	assert.doesNotMatch(source, /TerminayAiClient/u)
	assert.doesNotMatch(source, /AI_OPERATIONS/u)
	assert.doesNotMatch(source, /legacy-desktop|legacy-project|legacy-app|legacy-session/u)
	assert.doesNotMatch(source, /requestCounter|new Map</u)
})
