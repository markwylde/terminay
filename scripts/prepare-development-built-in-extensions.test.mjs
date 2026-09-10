import assert from 'node:assert/strict'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { prepareDevelopmentBuiltInExtensions } from './prepare-development-built-in-extensions.mjs'

test('development prerequisite stages and verifies six built-ins from an absent output directory', async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-dev-built-ins-'))
	try {
		const outputDirectory = join(root, 'absent', 'built-in-extensions')
		await assert.rejects(access(outputDirectory))
		const result = await prepareDevelopmentBuiltInExtensions({ outputDirectory })
		assert.equal(result.artifacts.length, 6)
		await access(join(outputDirectory, 'inventory.v1.json'))
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})
