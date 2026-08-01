import assert from 'node:assert/strict'
import test from 'node:test'
import { TASK19_ARCHITECTURE_EVIDENCE, TASK19_FEATURE_MATRIX, TASK19_SURFACES, summarizeTask19FeatureMatrix, validateTask19FeatureMatrix } from './task19-compatibility-matrix.mjs'
import { auditOneServerModel } from './one-server-model-boundary.mjs'

test('Task 19 records every required host surface against every canonical feature', async () => {
	const report = await validateTask19FeatureMatrix()
	assert.deepEqual(report.surfaces, ['local-desktop', 'remote-desktop', 'wide-web', 'mobile-web'])
	assert.equal(report.summary.featureCount, 13)
	assert.equal(report.summary.surfaceCount, 4)
	assert.equal(report.summary.cellCount, 52)
	assert.equal(report.summary.completeCells, 0)
	assert.equal(report.summary.contractCells, 26)
	assert.equal(report.summary.partialCells, 26)
	assert.equal(report.summary.openCells, 0)
	assert.deepEqual(TASK19_SURFACES, report.surfaces)
	assert.deepEqual(report.architectureEvidence, TASK19_ARCHITECTURE_EVIDENCE)
})

test('Task 19 matrix evidence is backed by an exact-zero connected-renderer authority gate', async () => {
	assert.deepEqual(await auditOneServerModel(), [])
})

test('Task 19 matrix cannot silently turn partial or external work into completion', () => {
	const summary = summarizeTask19FeatureMatrix([
		{ ...TASK19_FEATURE_MATRIX[0], status: Object.fromEntries(TASK19_SURFACES.map((surface) => [surface, 'partial'])) },
	])
	assert.equal(summary.completeCells, 0)
	assert.equal(summary.partialCells, 4)
})

test('Task 19 validation accepts an evidence-backed all-contract matrix', async () => {
	const contractOnlyMatrix = TASK19_FEATURE_MATRIX.map((feature) => ({
		...feature,
		status: Object.fromEntries(TASK19_SURFACES.map((surface) => [surface, 'contract'])),
	}))
	const report = await validateTask19FeatureMatrix(process.cwd(), contractOnlyMatrix)
	assert.equal(report.summary.contractCells, 52)
	assert.equal(report.summary.partialCells, 0)
	assert.equal(report.summary.openCells, 0)
})

test('Task 19 rejects contract cells whose row loses evidence or parity semantics', async () => {
	const contractStatus = Object.fromEntries(TASK19_SURFACES.map((surface) => [surface, 'contract']))
	await assert.rejects(
		validateTask19FeatureMatrix(process.cwd(), [{
			...TASK19_FEATURE_MATRIX[0],
			evidence: ['scripts/missing-task19-evidence.test.mjs'],
			status: contractStatus,
		}]),
		/ENOENT|no such file/u,
	)
	await assert.rejects(
		validateTask19FeatureMatrix(process.cwd(), [{
			...TASK19_FEATURE_MATRIX[0],
			gap: '   ',
			status: contractStatus,
		}]),
		/incomplete Task 19 feature row/u,
	)
})

test('Task 19 records completed task evidence at its canonical completed path', async () => {
	const completedTask = TASK19_FEATURE_MATRIX.find((feature) => feature.id === 'server-mcp-control')
	assert.equal(completedTask.spec, 'specs/tasks_completed/10-server-mcp-control.md')
	const report = await validateTask19FeatureMatrix()
	assert.ok(report.features.some((feature) => feature.id === 'server-mcp-control'))
})
