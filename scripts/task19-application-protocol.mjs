import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

/**
 * These are deterministic local application-protocol suites. They use local
 * transports, fake bounded channels, filesystem fixtures, or the browser
 * host's origin-scoped reconnect-vault contract; this list deliberately does
 * not represent a real hosted/browser pairing run.
 */
export const TASK19_APPLICATION_PROTOCOL_SUITES = Object.freeze([
	'packages/server-core/test/workspace-project-move-protocol.test.mjs',
	'packages/server-core/test/terminal-protocol.test.mjs',
	'packages/server-core/test/git-framed-client.test.mjs',
	'packages/server-core/test/macro-protocol.test.mjs',
	'packages/server-core/test/ai-protocol.test.mjs',
	'packages/server-core/test/remote-channel-transport.test.mjs',
	'packages/server-core/test/remote-application-conformance.test.mjs',
	'packages/server-core/test/remote-application.test.mjs',
	'packages/server-core/test/remote-headless-conformance.test.mjs',
	'packages/server-core/test/file-viewer-client-e2e.test.mjs',
	'packages/server-core/test/remote-pairing.test.mjs',
	'packages/server-core/test/remote-reconnect.test.mjs',
	'apps/terminay-web/test/connection-host.test.mjs',
	'scripts/web-reconnect-attempt-lifecycle.test.mjs',
])

export const TASK19_APPLICATION_PROTOCOL_DOMAINS = Object.freeze({
	workspace: 'packages/server-core/test/workspace-project-move-protocol.test.mjs',
	terminal: 'packages/server-core/test/terminal-protocol.test.mjs',
	git: 'packages/server-core/test/git-framed-client.test.mjs',
	macros: 'packages/server-core/test/macro-protocol.test.mjs',
	ai: 'packages/server-core/test/ai-protocol.test.mjs',
	files: 'packages/server-core/test/file-viewer-client-e2e.test.mjs',
	remote: 'packages/server-core/test/remote-application-conformance.test.mjs',
	pairing: 'packages/server-core/test/remote-pairing.test.mjs',
	reconnect: 'packages/server-core/test/remote-reconnect.test.mjs',
	browserReconnectVault: 'apps/terminay-web/test/connection-host.test.mjs',
})

export async function validateTask19ApplicationProtocolSuites(root = process.cwd()) {
	for (const suite of TASK19_APPLICATION_PROTOCOL_SUITES) await access(join(root, suite))
	for (const [domain, suite] of Object.entries(TASK19_APPLICATION_PROTOCOL_DOMAINS)) {
		if (!TASK19_APPLICATION_PROTOCOL_SUITES.includes(suite)) {
			throw new Error(`Task 19 application-protocol domain is not exercised: ${domain}`)
		}
	}
	return Object.freeze({
		suites: TASK19_APPLICATION_PROTOCOL_SUITES,
		domains: TASK19_APPLICATION_PROTOCOL_DOMAINS,
		externalPairingRun: false,
		realBrowserRun: false,
	})
}

/** Run only the checked-in deterministic protocol suites. The caller must
 * build the workspaces first, just as the package test scripts do. */
export async function runTask19ApplicationProtocolSuites(root = process.cwd(), nodePath = process.execPath) {
	await validateTask19ApplicationProtocolSuites(root)
	const results = []
	for (const suite of TASK19_APPLICATION_PROTOCOL_SUITES) {
		const result = spawnSync(nodePath, ['--test', suite], {
			cwd: root,
			encoding: 'utf8',
			env: { ...process.env },
		})
		const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
		const tests = /ℹ tests (\d+)/u.exec(output)?.[1]
		const passed = /ℹ pass (\d+)/u.exec(output)?.[1]
		results.push(Object.freeze({
			suite,
			status: result.status ?? 1,
			...(tests === undefined ? {} : { tests: Number(tests) }),
			...(passed === undefined ? {} : { passed: Number(passed) }),
			output,
		}))
		if (result.status !== 0) {
			throw new Error(`Task 19 application-protocol suite failed: ${suite}\n${output}`)
		}
	}
	return Object.freeze({
		suites: Object.freeze(results),
		domains: TASK19_APPLICATION_PROTOCOL_DOMAINS,
		externalPairingRun: false,
		realBrowserRun: false,
	})
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const report = await runTask19ApplicationProtocolSuites()
	console.log(JSON.stringify({
		checkedInSuites: report.suites.map(({ suite, status, tests, passed }) => ({ suite, status, tests, passed })),
		externalPairingRun: report.externalPairingRun,
		realBrowserRun: report.realBrowserRun,
	}, null, 2))
}
