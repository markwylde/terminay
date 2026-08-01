import assert from 'node:assert/strict'
import test from 'node:test'
import {
	inspectDockerHealthResponses,
	inspectDockerReadiness,
	inspectRuntimeHardening,
	redactPairingUrl,
} from './task20-docker-server-smoke.mjs'

const PAIRING_URL = 'http://localhost:8080/#pairingExpiresAt=2026-07-27T21%3A00%3A00.000Z&pairingSessionId=pair-task20&pairingToken=task20-secret-token'

const READINESS = {
	ready: true,
	serverId: 'task20-docker-server',
	version: 'task20-local',
	endpoint: 'loopback',
	dataRoot: '/var/lib/terminay',
	healthEndpoint: 'http://0.0.0.0:8080',
	pairing: {
		pairingSessionId: 'pair-task20',
		pairingExpiresAt: '2026-07-27T21:00:00.000Z',
		pairingUrl: PAIRING_URL,
		expiresInSeconds: 300,
		requiresApproval: true,
	},
}

const HEALTH = [
	{
		method: 'GET',
		path: '/healthz',
		status: 200,
		body: { status: 'ok', ready: true, phase: 'ready', serverId: 'task20-docker-server', version: 'task20-local' },
	},
	{
		method: 'GET',
		path: '/readyz',
		status: 200,
		body: { status: 'ok', ready: true, phase: 'ready', serverId: 'task20-docker-server', version: 'task20-local' },
	},
	{
		method: 'HEAD',
		path: '/readyz',
		status: 200,
		bodyLength: 0,
	},
]

test('Task 20 Docker readiness inspection redacts fragment credentials', () => {
	const inspected = inspectDockerReadiness(READINESS)
	assert.equal(inspected.serverId, 'task20-docker-server')
	assert.equal(inspected.dataRoot, '/var/lib/terminay')
	assert.equal(inspected.pairingUrl, redactPairingUrl(PAIRING_URL))
	assert.equal(inspected.tokenLength, 'task20-secret-token'.length)
	assert.equal(JSON.stringify(inspected).includes('task20-secret-token'), false)
	assert.throws(() => inspectDockerReadiness({ ...READINESS, pairing: { ...READINESS.pairing, pairingToken: 'leaked' } }), /must not be exposed/u)
	assert.throws(() => inspectDockerReadiness({ ...READINESS, healthEndpoint: 'http://127.0.0.1:8080' }), /health endpoint/u)
})

test('Task 20 Docker health inspection accepts only lifecycle metadata', () => {
	const inspected = inspectDockerHealthResponses(HEALTH)
	assert.deepEqual(inspected, {
		status: 'passed',
		endpoints: ['/healthz', '/readyz'],
		headReadyz: true,
		unauthenticated: true,
		serverId: 'task20-docker-server',
		version: 'task20-local',
	})
	assert.throws(() => inspectDockerHealthResponses(HEALTH.map((probe) => probe.method === 'GET' ? { ...probe, body: { ...probe.body, dataRoot: '/var/lib/terminay' } } : probe)), /unexpected fields/u)
	assert.throws(() => inspectDockerHealthResponses(HEALTH.map((probe) => probe.method === 'HEAD' ? { ...probe, bodyLength: 12 } : probe)), /body/u)
})

test('Task 20 Docker hardening inspection requires non-root and read-only-root evidence', () => {
	const inspected = inspectRuntimeHardening({
		uid: '10001',
		gid: '10001',
		readOnlyRootfs: true,
		noNewPrivileges: true,
		capDropAll: true,
		tmpfsTmp: true,
		dataRootWritable: true,
		rootWriteBlocked: true,
	})
	assert.equal(inspected.uid, '10001')
	assert.equal(inspected.readOnlyRootfs, true)
	assert.throws(() => inspectRuntimeHardening({ uid: '0', gid: '0' }), /UID\/GID/u)
	assert.throws(() => inspectRuntimeHardening({
		uid: '10001',
		gid: '10001',
		readOnlyRootfs: false,
		noNewPrivileges: true,
		capDropAll: true,
		tmpfsTmp: true,
		dataRootWritable: true,
		rootWriteBlocked: true,
	}), /read-only/u)
})
