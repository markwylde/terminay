import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

const featureDirectory = new URL('../specs/features/', import.meta.url)
const matrix = await readFile(new URL('../specs/decisions/evidence/task16-feature-parity-matrix.md', import.meta.url), 'utf8')

test('Task 16 feature parity matrix covers every canonical feature spec', async () => {
	const features = (await readdir(featureDirectory))
		.filter(name => name.endsWith('.md') && name !== 'AGENTS.md')
		.sort()

	assert.equal(features.length, 17)
	for (const feature of features) {
		assert.ok(matrix.includes(`\`${feature}\``), `matrix is missing ${feature}`)
	}
})

test('Task 16 feature parity matrix keeps incomplete rows explicit', () => {
	const rows = matrix.split('\n').filter(line => line.startsWith('| `'))
	assert.equal(rows.length, 17)
	for (const row of rows) {
		assert.match(row, /\| Partial \|/u)
		assert.doesNotMatch(row, /\| Complete \|/u)
	}
	assert.match(matrix, /A row can move from `Partial` to `Complete` only when:/u)
})
