import assert from 'node:assert/strict'
import test from 'node:test'
import {
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
