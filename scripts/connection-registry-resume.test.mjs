import assert from 'node:assert/strict'
import test from 'node:test'
import {
	CLIENT_SERVER_COMPATIBILITY,
	CONNECTION_METRICS_CAPABILITY,
	CONNECTION_METRICS_OPERATIONS,
} from '@terminay/protocol'
import { ConnectionRegistry } from '../src/shared/connections/connectionRegistry.ts'

/**
 * Back in the app after the transport died while hidden: the peer still says
 * connected and nothing has closed. The resume probe is the only signal, and
 * one miss must start recovery at once. Each connect and recovery is reported
 * as one metadata-only timing sample to a server that keeps them.
 */

function transport() {
	return {
		state: 'open',
		async open() {},
		async close() {
			this.state = 'closed'
		},
		async send() {},
		onStateChange: () => () => {},
		incoming: { [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true }) }) },
	}
}

function hello(serverId, extra = []) {
	return {
		type: 'server_hello',
		serverId,
		clientId: `client-${serverId}`,
		serverVersion: '1.0.0',
		protocolVersion: 1,
		capabilities: [
			...CLIENT_SERVER_COMPATIBILITY.requiredCapabilities,
			...CLIENT_SERVER_COMPATIBILITY.optionalCapabilities,
			...extra,
		],
	}
}

/** A registry whose clients answer pings unless `isDead(index)` and record
 * every command they are sent. */
function harness(serverHello, { isDead = () => false, now, connectTimings, open, desktop = false, onJoin = () => {}, connect } = {}) {
	const made = []
	const commands = []
	const opened = []
	const requests = []
	const probes = []
	const registry = new ConnectionRegistry({
		createClientId: (role) => `client-${role}`,
		...(desktop ? { onRemoteRetryJoin: onJoin } : {}),
		...(now === undefined ? {} : { now }),
		createClient: (options) => {
			const index = made.length
			const client = {
				options,
				declareServerCompatibility() {},
				async connect() {
					return connect?.(index) ?? serverHello
				},
				async close() {},
				query: (_operation, _payload, { signal } = {}) => {
					probes.push(index)
					return isDead(index)
						? new Promise((_, reject) =>
								signal?.addEventListener('abort', () => reject(new Error('aborted'))),
							)
						: Promise.resolve({ ok: true })
				},
				async command(operation, payload) {
					commands.push({ operation, payload })
					return { ok: true }
				},
				onStateChange: () => () => {},
			}
			made.push(client)
			return client
		},
		createContext: async (client, server) => ({
			applicationClient: client,
			serverId: server.serverId,
			clientId: server.clientId,
			serverCapabilities: server.capabilities,
			dispose: async () => {},
		}),
		open: async (request) => {
			requests.push(request)
			opened.push(request.profileId)
			await open?.(request)
			return {
				transport: transport(),
				label: 'Remote',
				...(desktop ? { hostContext: { profile: { isLocal: false } } } : {}),
				...(connectTimings === undefined ? {} : { connectTimings }),
			}
		},
	})
	return { commands, made, opened, probes, requests, registry }
}

function settled(registry, predicate) {
	if (predicate(registry.snapshot)) return Promise.resolve(registry.snapshot)
	return new Promise((resolve) => {
		const unsubscribe = registry.subscribe((current) => {
			if (!predicate(current)) return
			unsubscribe()
			resolve(current)
		})
	})
}

test('a resume probe that misses recovers at once and reports its timings', async () => {
	let now = 0
	let dead = false
	const { commands, made, opened, registry } = harness(
		hello('server-metrics', [CONNECTION_METRICS_CAPABILITY]),
		{
			now: () => now,
			isDead: (index) => dead && index === 0,
			connectTimings: () => ({ signalMs: 40, iceMs: 60, hostname: 'leak' }),
		},
	)
	registry.startPrimary('primary')
	await settled(registry, (current) => current.primary?.phase === 'ready')
	assert.equal(commands.length, 1, 'the first connect is reported')
	assert.equal(commands[0].operation, CONNECTION_METRICS_OPERATIONS.record)
	assert.equal(commands[0].payload.sample.kind, 'connect')
	assert.equal(commands[0].payload.sample.trigger, 'initial')
	assert.equal(commands[0].payload.sample.signalMs, 40)
	assert.equal('hostname' in commands[0].payload.sample, false, 'host timings are re-validated')

	registry.suspend()
	now = 60_000
	dead = true
	const resumedAt = Date.now()
	registry.resume()
	await settled(registry, (current) => current.primary?.phase === 'reconnecting')
	const detectedIn = Date.now() - resumedAt
	assert.equal(detectedIn < 2_500, true, `loss was found ${detectedIn}ms after resume`)
	now = 61_600
	await settled(registry, (current) => current.primary?.phase === 'ready' && made.length === 2)
	assert.equal(opened.length, 2)

	const sample = commands.at(-1).payload.sample
	assert.equal(sample.kind, 'recover')
	assert.equal(sample.trigger, 'resume-probe')
	assert.equal(sample.host, 'browser')
	assert.equal(sample.hiddenMs, 60_000)
	assert.equal(sample.detectMs, 0, 'detection is measured from the resume')
	assert.equal(sample.attempts, 1)
	await registry.dispose()
})

test('a resume probe that is answered reports that the connection survived', async () => {
	const { commands, made, registry } = harness(
		hello('server-alive', [CONNECTION_METRICS_CAPABILITY]),
	)
	registry.startPrimary('primary')
	await settled(registry, (current) => current.primary?.phase === 'ready')
	registry.suspend()
	registry.resume()
	for (let tick = 0; tick < 40 && commands.length < 2; tick += 1)
		await new Promise((resolve) => setTimeout(resolve, 5))
	assert.equal(commands.at(-1).payload.sample.kind, 'resume-alive')
	assert.equal(typeof commands.at(-1).payload.sample.probeRttMs, 'number')
	assert.equal(registry.snapshot.primary.phase, 'ready')
	assert.equal(made.length, 1, 'no reconnect for a live transport')
	await registry.dispose()
})

test('a server that does not keep timings is never sent one', async () => {
	const { commands, registry } = harness(hello('server-plain'))
	registry.startPrimary('primary')
	await settled(registry, (current) => current.primary?.phase === 'ready')
	registry.resume()
	await new Promise((resolve) => setTimeout(resolve, 20))
	assert.deepEqual(commands, [])
	await registry.dispose()
})

test('native wake probes an already visible remote window and coalesces visibility', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
	let dead = false
	let joined = 0
	let finishReplacement
	const held = new Promise((resolve) => { finishReplacement = resolve })
	const firstFailure = 'Desktop did not receive the replacement connection. Retry connection.'
	let replacementCalls = 0
	const { made, probes, requests, registry } = harness(hello('remote'), {
		desktop: true,
		isDead: (index) => dead && index === 0,
		onJoin: () => { joined++ },
		open: async ({ replaceEndpoint }) => {
			if (!replaceEndpoint) return
			if (++replacementCalls === 1) throw new Error(firstFailure)
			await held
		},
	})
	try {
		registry.startPrimary('primary')
		await settled(registry, (state) => state.primary?.phase === 'ready')
		registry.resumeRemotePrimary()
		registry.resume()
		assert.deepEqual(probes, [0])
		assert.equal(made.length, 1)
		await new Promise((resolve) => setImmediate(resolve))
		assert.equal(registry.snapshot.primary.phase, 'ready')

		dead = true
		registry.resumeRemotePrimary()
		registry.resume()
		assert.deepEqual(probes, [0, 0])
		t.mock.timers.tick(1500)
		await settled(registry, (state) => state.primary?.error === firstFailure)
		assert.equal(requests[1].replaceEndpoint, true)
		assert.equal(requests[1].manual, false)

		registry.snapshot.primary.retry()
		assert.equal(registry.snapshot.primary.recoveryProgress, 'retrying')
		assert.equal(registry.snapshot.primary.error, undefined)
		registry.snapshot.primary.retry()
		assert.equal(joined, 1)
		await new Promise((resolve) => setImmediate(resolve))
		assert.equal(requests.length, 3)
		assert.equal(requests[2].manual, true)
		// Negotiation is host-bounded. The old renderer-only 20-second
		// deadline should not expire before the replacement endpoint arrives.
		t.mock.timers.tick(20_000)
		assert.equal(registry.snapshot.primary.recoveryProgress, 'retrying')
		finishReplacement()
		await settled(registry, (state) => state.primary?.phase === 'ready')
		assert.equal(made.length, 2)
	} finally {
		finishReplacement()
		await registry.dispose()
	}
})

test('remote hydration times out after handoff and a late hello cannot win', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
	let finishHello
	const stalled = new Promise((resolve) => { finishHello = resolve })
	const server = hello('remote')
	const { made, registry } = harness(server, {
		desktop: true,
		connect: (index) => index === 1 ? stalled : server,
	})
	try {
		registry.startPrimary('primary')
		await settled(registry, (state) => state.primary?.phase === 'ready')
		registry.snapshot.primary.retry()
		await new Promise((resolve) => setImmediate(resolve))
		t.mock.timers.tick(20_000)
		await settled(registry, (state) => state.primary?.error?.includes('timed out'))
		assert.equal(registry.snapshot.primary.recoveryProgress, undefined)
		registry.snapshot.primary.retry()
		await settled(registry, (state) => state.primary?.phase === 'ready')
		finishHello(server)
		await new Promise((resolve) => setImmediate(resolve))
		assert.equal(registry.snapshot.primary.client, made[2])
	} finally {
		finishHello(server)
		await registry.dispose()
	}
})

test('a verified revocation ends Desktop recovery and exposes the pairing state', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
	const pairingRequired = 'This device must be paired again.'
	const { requests, registry } = harness(hello('remote'), {
		desktop: true,
		open: async ({ replaceEndpoint }) => {
			if (replaceEndpoint) throw new Error(pairingRequired)
		},
	})
	try {
		registry.startPrimary('primary')
		await settled(registry, (state) => state.primary?.phase === 'ready')
		registry.snapshot.primary.retry()
		const stopped = await settled(registry, (state) => state.primary?.phase === 'unreachable')
		assert.equal(stopped.primary.error, pairingRequired)
		assert.equal(stopped.primary.context, undefined)
		assert.equal(stopped.primary.recoveryProgress, undefined)
		t.mock.timers.tick(120_000)
		await new Promise((resolve) => setImmediate(resolve))
		assert.equal(requests.length, 2, 'revocation cancels automatic recovery')
	} finally {
		await registry.dispose()
	}
})
