import assert from 'node:assert/strict'
import test from 'node:test'
import {
	TASK19_APPLICATION_PROTOCOL_DOMAINS,
	TASK19_APPLICATION_PROTOCOL_SUITES,
	validateTask19ApplicationProtocolSuites,
} from './task19-application-protocol.mjs'

test('Task 19 application-protocol evidence is an explicit local suite inventory', async () => {
	const report = await validateTask19ApplicationProtocolSuites()
	assert.equal(report.externalPairingRun, false)
	assert.equal(report.realBrowserRun, false)
	assert.equal(report.suites.length, 14)
	assert.deepEqual(report.domains, TASK19_APPLICATION_PROTOCOL_DOMAINS)
	assert.deepEqual(
		Object.keys(report.domains),
		['workspace', 'terminal', 'git', 'macros', 'ai', 'files', 'remote', 'pairing', 'reconnect', 'browserReconnectVault'],
	)
	for (const suite of Object.values(report.domains)) assert.ok(report.suites.includes(suite))
	assert.ok(report.suites.includes('packages/server-core/test/workspace-project-move-protocol.test.mjs'))
	assert.ok(report.suites.includes('packages/server-core/test/terminal-protocol.test.mjs'))
	assert.ok(report.suites.includes('packages/server-core/test/git-framed-client.test.mjs'))
	assert.ok(report.suites.includes('packages/server-core/test/macro-protocol.test.mjs'))
	assert.ok(report.suites.includes('packages/server-core/test/ai-protocol.test.mjs'))
	assert.ok(report.suites.includes('packages/server-core/test/remote-channel-transport.test.mjs'))
	assert.ok(report.suites.includes('packages/server-core/test/file-viewer-client-e2e.test.mjs'))
	assert.ok(report.suites.includes('packages/server-core/test/remote-pairing.test.mjs'))
	assert.ok(report.suites.includes('packages/server-core/test/remote-reconnect.test.mjs'))
	assert.ok(report.suites.includes('apps/terminay-web/test/connection-host.test.mjs'))
	assert.ok(report.suites.includes('scripts/web-reconnect-attempt-lifecycle.test.mjs'))
	assert.deepEqual(report.suites, TASK19_APPLICATION_PROTOCOL_SUITES)
})
