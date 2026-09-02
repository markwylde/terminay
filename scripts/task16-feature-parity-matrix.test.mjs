import assert from 'node:assert/strict'
import { access, readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

const capabilityDirectory = new URL('../openspec/specs/', import.meta.url)
const matrix = await readFile(new URL('../openspec/adr/evidence/task16-feature-parity-matrix.md', import.meta.url), 'utf8')

// The matrix is frozen Task 16-era evidence naming the 17 feature specs that
// existed when it was written. Every row must still resolve to a canonical
// OpenSpec capability; capabilities added after Task 16 are out of its scope.
const matrixCapabilities = [...matrix.matchAll(/^\| `([a-z0-9-]+)\.md` \|/gmu)].map(match => match[1])

test('Task 16 feature parity matrix names only canonical OpenSpec capabilities', async () => {
	assert.equal(matrixCapabilities.length, 17)
	const capabilities = new Set(
		(await readdir(capabilityDirectory, { withFileTypes: true }))
			.filter(entry => entry.isDirectory())
			.map(entry => entry.name),
	)
	for (const capability of matrixCapabilities) {
		assert.ok(capabilities.has(capability), `matrix names a missing capability: ${capability}`)
		await access(new URL(`${capability}/spec.md`, capabilityDirectory))
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
