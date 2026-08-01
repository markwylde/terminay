import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectTask18WebHostReadiness, TASK18_WEB_MANAGER_ORIGIN } from './task18-web-host-readiness.mjs'

test('Task 18 web-host readiness is deterministic and local-only', async () => {
	const first = await inspectTask18WebHostReadiness()
	const second = await inspectTask18WebHostReadiness()
	assert.deepEqual(first, second)
	assert.equal(first.managerOrigin, TASK18_WEB_MANAGER_ORIGIN)
	assert.equal(first.localProfilePresent, false)
	assert.equal(first.exactOriginRouteNavigation, true)
	assert.equal(first.externalDeploymentVerified, false)
	assert.equal(first.publicDnsVerified, false)
	assert.equal(first.verificationScope, 'local package, build output, and host contract only')
	assert.deepEqual(first.artifacts.map((entry) => entry.path), [
		'apps/terminay-web/dist/index.js',
		'apps/terminay-web/dist/index.d.ts',
	])
	for (const entry of first.artifacts) {
		assert.ok(entry.bytes > 0)
		assert.match(entry.sha256, /^[a-f0-9]{64}$/u)
	}
})
