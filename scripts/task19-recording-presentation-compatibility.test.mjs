import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Task 19 canonical recordings DTO has no legacy host-presentation adapter shape', async () => {
	const source = await readFile('packages/client-core/src/recordings.ts', 'utf8')

	assert.doesNotMatch(source, /Optional display metadata retained by compatibility adapters/u)
	assert.doesNotMatch(source, /validatePresentationMetadata/u)
	assert.doesNotMatch(source, /readonly projectTitle\?:/u)
	assert.doesNotMatch(source, /readonly projectColor\?:/u)
	assert.doesNotMatch(source, /readonly projectEmoji\?:/u)
	assert.doesNotMatch(source, /readonly theme\?:/u)
	assert.match(source, /Ignore unknown legacy fields/u)
})
