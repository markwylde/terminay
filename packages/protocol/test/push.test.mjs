import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import {
	FEATURE_CAPABILITIES,
	CLIENT_SERVER_COMPATIBILITY,
	openPushPayload,
	parsePushEnrolment,
	PUSH_PLAINTEXT_BYTES,
	PUSH_SEALED_BYTES,
	pushPayloadRoutingId,
	sealPushPayload,
} from '../dist/index.js'

const enrolment = () => ({
	routingId: randomBytes(16).toString('base64url'),
	key: randomBytes(32).toString('base64url'),
	token: randomBytes(32).toString('base64url'),
	silent: true,
})

const banner = (overrides = {}) => ({
	id: 'n-0b1c2d3e-0000-4000-8000-000000000001',
	kind: 'agent-finished',
	terminalTitle: 'Terminal 1',
	projectTitle: 'Project 2',
	raisedAt: 1_791_720_594_000,
	projectId: 'project-a',
	sessionId: 'session-a',
	...overrides,
})

test('a sealed payload round-trips and is always one fixed length', async () => {
	const device = enrolment()
	const state = { sequence: 7, count: 2, outstanding: ['n-1', 'n-2'], banner: banner() }
	const sealed = await sealPushPayload(device, state)
	assert.equal(sealed.byteLength, PUSH_SEALED_BYTES)
	assert.equal(sealed[0], 1)
	assert.equal(pushPayloadRoutingId(sealed), device.routingId)
	assert.deepEqual(await openPushPayload(device, sealed), { ...state, truncated: false })
})

test('two pushes of different kinds and title lengths seal to the same length', async () => {
	const device = enrolment()
	const short = await sealPushPayload(device, { sequence: 1, count: 1, outstanding: ['n-1'], banner: banner({ terminalTitle: 'a' }) })
	const long = await sealPushPayload(device, {
		sequence: 2,
		count: 9999,
		outstanding: Array.from({ length: 20 }, (_, index) => `n-${index}`),
		banner: banner({
			kind: 'message',
			terminalTitle: 'T'.repeat(80),
			projectTitle: 'P'.repeat(80),
			messageTitle: 'M'.repeat(80),
			messageBody: 'B'.repeat(280),
		}),
	})
	const stateOnly = await sealPushPayload(device, { sequence: 3, count: 0, outstanding: [] })
	assert.equal(short.byteLength, long.byteLength)
	assert.equal(short.byteLength, stateOnly.byteLength)
})

test('a state push carries no banner', async () => {
	const device = enrolment()
	const opened = await openPushPayload(device, await sealPushPayload(device, { sequence: 3, count: 0, outstanding: [] }))
	assert.equal(opened.banner, undefined)
	assert.equal(opened.count, 0)
})

test('a sent notification keeps its text; any other kind carries none', async () => {
	const device = enrolment()
	const message = await openPushPayload(device, await sealPushPayload(device, {
		sequence: 1, count: 1, outstanding: [],
		banner: banner({ kind: 'message', messageTitle: 'Review ready', messageBody: 'Three files changed' }),
	}))
	assert.equal(message.banner.messageTitle, 'Review ready')
	assert.equal(message.banner.messageBody, 'Three files changed')

	const activity = await openPushPayload(device, await sealPushPayload(device, {
		sequence: 2, count: 1, outstanding: [],
		banner: banner({ messageTitle: 'smuggled', messageBody: 'smuggled' }),
	}))
	assert.equal(activity.banner.messageTitle, undefined)
	assert.equal(activity.banner.messageBody, undefined)
})

test('the worst-case banner fits, with four-byte characters throughout', async () => {
	const device = enrolment()
	const wide = '\u{1F600}'
	const state = {
		sequence: 1,
		count: 9999,
		outstanding: Array.from({ length: 200 }, (_, index) => `n-0b1c2d3e-0000-4000-8000-${String(index).padStart(12, '0')}`),
		banner: banner({
			kind: 'message',
			terminalTitle: wide.repeat(80),
			projectTitle: wide.repeat(80),
			messageTitle: wide.repeat(80),
			messageBody: wide.repeat(280),
		}),
	}
	const opened = await openPushPayload(device, await sealPushPayload(device, state))
	assert.equal(opened.banner.messageBody, state.banner.messageBody)
	assert.equal(opened.truncated, true, 'the outstanding list is what gives way')
	assert.ok(opened.outstanding.length < 200)
	assert.deepEqual(opened.outstanding, state.outstanding.slice(0, opened.outstanding.length), 'newest first survive')
	assert.ok(PUSH_PLAINTEXT_BYTES > 2600)
})

test('over-long titles are cut to their bound', async () => {
	const device = enrolment()
	const opened = await openPushPayload(device, await sealPushPayload(device, {
		sequence: 1, count: 1, outstanding: [], banner: banner({ terminalTitle: 'x'.repeat(200) }),
	}))
	assert.equal(opened.banner.terminalTitle.length, 80)
})

test('a payload opens only under its own key and routing id', async () => {
	const a = enrolment()
	const b = enrolment()
	const sealed = await sealPushPayload(a, { sequence: 1, count: 1, outstanding: [], banner: banner() })

	await assert.rejects(openPushPayload(b, sealed), 'another pairing cannot open it')
	await assert.rejects(openPushPayload({ ...a, key: b.key }, sealed), 'the wrong key fails')

	// Server A naming server B's routing id, sealed under A's own key.
	const forged = await sealPushPayload({ routingId: b.routingId, key: a.key }, { sequence: 1, count: 1, outstanding: [], banner: banner() })
	assert.equal(pushPayloadRoutingId(forged), b.routingId)
	await assert.rejects(openPushPayload(b, forged), 'B does not accept what A sealed')

	// Rewriting the routing id in transit breaks the seal: it is bound as associated data.
	const rerouted = Uint8Array.from(sealed)
	rerouted.set(Buffer.from(b.routingId, 'base64url'), 1)
	await assert.rejects(openPushPayload({ routingId: b.routingId, key: a.key }, rerouted))
})

test('an altered byte anywhere fails to open', async () => {
	const device = enrolment()
	const sealed = await sealPushPayload(device, { sequence: 1, count: 1, outstanding: [], banner: banner() })
	for (const index of [0, 5, 20, 40, 1500, PUSH_SEALED_BYTES - 1]) {
		const altered = Uint8Array.from(sealed)
		altered[index] ^= 0x01
		await assert.rejects(async () => openPushPayload(device, altered), `byte ${index}`)
	}
	await assert.rejects(async () => openPushPayload(device, sealed.subarray(1)))
})

test('two seals of the same state differ, so a payload cannot be recognised by its bytes', async () => {
	const device = enrolment()
	const state = { sequence: 1, count: 1, outstanding: [], banner: banner() }
	const first = await sealPushPayload(device, state)
	const second = await sealPushPayload(device, state)
	assert.notDeepEqual(first, second)
})

test('an invalid state is refused before it is sealed', async () => {
	const device = enrolment()
	await assert.rejects(sealPushPayload(device, { sequence: -1, count: 0, outstanding: [] }))
	await assert.rejects(sealPushPayload(device, { sequence: 1, count: 10_000, outstanding: [] }))
	await assert.rejects(sealPushPayload(device, { sequence: 1, count: 0, outstanding: ['bad id'] }))
	await assert.rejects(sealPushPayload(device, { sequence: 1, count: 1, outstanding: [], banner: banner({ kind: 'nonsense' }) }))
	await assert.rejects(sealPushPayload({ ...device, key: 'short' }, { sequence: 1, count: 0, outstanding: [] }))
})

test('an enrolment is validated exactly as the manager hands it over', () => {
	const device = enrolment()
	assert.deepEqual(parsePushEnrolment(device), device)
	assert.throws(() => parsePushEnrolment({ ...device, endpoint: 'https://example.test' }), /unknown field/)
	assert.throws(() => parsePushEnrolment({ ...device, silent: 'yes' }))
	assert.throws(() => parsePushEnrolment({ ...device, key: device.key.slice(2) }))
	assert.throws(() => parsePushEnrolment({ ...device, routingId: `${device.routingId}=` }))
	assert.throws(() => parsePushEnrolment({ ...device, token: undefined }))
	assert.throws(() => parsePushEnrolment(null))
})

test('push is a versioned capability a client can do without', () => {
	assert.equal(FEATURE_CAPABILITIES.push, 'push.v1')
	assert.equal(CLIENT_SERVER_COMPATIBILITY.optionalCapabilities.includes(FEATURE_CAPABILITIES.push), true)
	assert.equal(CLIENT_SERVER_COMPATIBILITY.requiredCapabilities.includes(FEATURE_CAPABILITIES.push), false)
})
