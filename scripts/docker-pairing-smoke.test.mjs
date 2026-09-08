import assert from 'node:assert/strict'
import test from 'node:test'
import {
	inspectExposureHandoffs,
	inspectServerHandoff,
	inspectServerHealth,
	probeClientPairingParser,
	redactPairingUrl,
} from './docker-pairing-smoke.mjs'

const HANDOFF = {
	ready: true,
	serverId: 'docker-pairing-smoke',
	version: '1.2.3',
	endpoint: 'loopback',
	dataRoot: '/tmp/terminay-docker-pairing-smoke',
	logSink: null,
	healthEndpoint: 'http://127.0.0.1:8080',
	pairing: {
		pairingSessionId: 'pair-fixed-room',
		pairingExpiresAt: '2026-07-27T19:00:00.000Z',
		pairingUrl: 'https://docker-pairing-smoke.example.test/#pairingExpiresAt=2026-07-27T19%3A00%3A00.000Z&pairingSessionId=pair-fixed-room&pairingToken=fixed-token',
		expiresInSeconds: 300,
		requiresApproval: true,
	},
}

const HEALTH = [
	{
		path: '/healthz',
		status: 200,
		body: { status: 'ok', ready: true, phase: 'ready', serverId: 'docker-pairing-smoke', version: '1.2.3' },
	},
	{
		path: '/readyz',
		status: 200,
		body: { status: 'ok', ready: true, phase: 'ready', serverId: 'docker-pairing-smoke', version: '1.2.3' },
	},
]

test('Docker readiness validation requires the structured, origin-bound handoff and redacts the fragment', () => {
	const inspected = inspectServerHandoff(HANDOFF)
	assert.equal(inspected.origin, 'https://docker-pairing-smoke.example.test')
	assert.equal(inspected.pairingSessionId, 'pair-fixed-room')
	assert.equal(inspected.fragmentLength, HANDOFF.pairing.pairingUrl.split('#')[1].length)
	assert.equal(inspected.tokenLength, 'fixed-token'.length)
	assert.equal(inspected.pairingUrl, redactPairingUrl(HANDOFF.pairing.pairingUrl))
	assert.throws(() => inspectServerHandoff({ ...HANDOFF, pairing: { ...HANDOFF.pairing, pairingUrl: 'https://docker-pairing-smoke.example.test/#fixed-secret' } }), /structured pairing field/u)
	assert.throws(() => inspectServerHandoff({ ...HANDOFF, pairing: { ...HANDOFF.pairing, pairingToken: 'different-token' } }), /must not expose/u)
})

test('a direct exposure handoff keeps the /v1/ grammar and its secret in the fragment', () => {
	const secret = 'nG9E_ZoCVpw7MmR-qxRhxn9AeeUAPsQifRDcsrMEGn8'
	const readiness = {
		...HANDOFF,
		exposure: ['hosted', 'direct'],
		handoffs: [
			{
				mode: 'hosted',
				pairingUrl: `https://app.terminay.com/?s=524b6f409e8845828f48715171ed1400&hostName=box#${secret}`,
				pairingExpiresAt: '2026-07-27T19:00:00.000Z',
				serverId: 'docker-pairing-smoke',
			},
			{
				mode: 'direct',
				pairingUrl: `https://box.example.test:8443/v1/?hostName=box#${secret}`,
				pairingExpiresAt: '2026-07-27T19:00:00.000Z',
				serverId: 'docker-pairing-smoke',
			},
		],
	}
	const inspected = inspectExposureHandoffs(readiness, { directOrigin: 'https://box.example.test:8443' })
	assert.deepEqual(inspected.map((entry) => entry.mode), ['hosted', 'direct'])
	assert.equal(inspected[1].origin, 'https://box.example.test:8443')
	assert.equal(inspected[1].pathname, '/v1/')
	assert.equal(inspected[1].pairingUrl.includes(secret), false, 'the reported URL is redacted')

	const direct = (pairingUrl) => ({
		...readiness,
		handoffs: [readiness.handoffs[0], { ...readiness.handoffs[1], pairingUrl }],
	})
	assert.throws(() => inspectExposureHandoffs(direct(`http://box.example.test:8443/v1/?hostName=box#${secret}`)), /must use HTTPS/u)
	assert.throws(() => inspectExposureHandoffs(direct(`https://box.example.test:8443/?hostName=box#${secret}`)), /\/v1\/ path/u)
	assert.throws(() => inspectExposureHandoffs(direct(`https://box.example.test:8443/v1/?s=${secret}#${secret}`)), /only the non-secret host name/u)
	assert.throws(() => inspectExposureHandoffs(direct(`https://box.example.test:8443/v1/?hostName=box#`)), /no pairing fragment/u)
	assert.throws(
		() => inspectExposureHandoffs(readiness, { directOrigin: 'https://other.example.test' }),
		/configured direct origin/u,
	)
	assert.throws(() => inspectExposureHandoffs({ ...readiness, handoffs: [] }), /exactly one handoff per exposure mode/u)

	// A server that was never exposed reports no handoff at all.
	assert.deepEqual(inspectExposureHandoffs({ ...HANDOFF, exposure: [], handoffs: [] }), [])
})

test('Docker health validation requires both safe foreground lifecycle responses', () => {
	const inspected = inspectServerHealth(HEALTH)
	assert.deepEqual(inspected, {
		status: 'passed',
		phase: 'ready',
		serverId: 'docker-pairing-smoke',
		version: '1.2.3',
		endpoints: ['/healthz', '/readyz'],
	})
	assert.throws(() => inspectServerHealth(HEALTH.map((probe) => ({ ...probe, body: { ...probe.body, dataRoot: '/private/server' } }))), /unexpected field/u)
	assert.throws(() => inspectServerHealth(HEALTH.map((probe) => ({ ...probe, status: probe.path === '/readyz' ? 503 : probe.status }))), /readyz health probe/u)
})

test('the checked-in client parser rejects the obsolete opaque handoff', async () => {
	const result = await probeClientPairingParser('https://docker-pairing-smoke.example.test/#fixed-secret')
	assert.equal(result.status, 'blocked')
	assert.equal(result.blocker, 'client-pairing-schema-mismatch')
})

test('the checked-in client parser accepts the structured readiness handoff without returning the token', async () => {
	const result = await probeClientPairingParser(HANDOFF.pairing.pairingUrl)
	assert.equal(result.status, 'passed')
	assert.deepEqual(result.bootstrap, {
		pairingExpiresAt: HANDOFF.pairing.pairingExpiresAt,
		pairingSessionId: HANDOFF.pairing.pairingSessionId,
		pairingTokenLength: 'fixed-token'.length,
	})
	assert.equal('pairingToken' in result.bootstrap, false)
})
