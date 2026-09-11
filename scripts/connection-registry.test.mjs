import assert from 'node:assert/strict'
import test from 'node:test'
import { ConnectionRegistry } from '../src/shared/connections/connectionRegistry.ts'
import { CLIENT_SERVER_COMPATIBILITY } from '@terminay/protocol'

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

/** A client that answers the handshake with whatever hello the test wants. */
function fakeClientFactory(hellos) {
	const made = []
	return {
		made,
		create(options) {
			const profileHello = hellos[made.length] ?? hellos[hellos.length - 1]
			const client = {
				options,
				closed: false,
				declared: undefined,
				declareServerCompatibility(requirements) {
					this.declared = requirements
				},
				async connect() {
					if (profileHello instanceof Error) throw profileHello
					return profileHello
				},
				async close() {
					this.closed = true
				},
				async query() {
					return { ok: true }
				},
				onStateChange: () => () => {},
			}
			made.push(client)
			return client
		},
	}
}

function hello(serverId, capabilities = [
	...CLIENT_SERVER_COMPATIBILITY.requiredCapabilities,
	...CLIENT_SERVER_COMPATIBILITY.optionalCapabilities,
]) {
	return {
		type: 'server_hello',
		serverId,
		clientId: `client-${serverId}`,
		serverVersion: '1.0.0',
		protocolVersion: 1,
		capabilities,
	}
}

function registryFor(hellos, options = {}) {
	const clients = fakeClientFactory(hellos)
	const opened = []
	const registry = new ConnectionRegistry({
		createClientId: (role) => `client-${role}`,
		createClient: (clientOptions) => clients.create(clientOptions),
		createContext: async (client, server) => ({
			applicationClient: client,
			serverId: server.serverId,
			clientId: server.clientId,
			serverCapabilities: server.capabilities,
			dispose: async () => {},
		}),
		open: async ({ profileId }) => {
			opened.push(profileId)
			return { transport: transport(), label: `Label for ${profileId}` }
		},
		...options,
	})
	return { clients, opened, registry }
}

/** Wait for the registry to settle: every attempt is a microtask chain. */
async function settled(registry, predicate, attempts = 200) {
	for (let index = 0; index < attempts; index += 1) {
		if (predicate(registry.snapshot)) return registry.snapshot
		await new Promise((resolve) => setTimeout(resolve, 1))
	}
	throw new Error(
		`registry never settled: ${JSON.stringify(
			registry.snapshot.connections.map((entry) => [entry.profileId, entry.phase]),
		)}`,
	)
}

test('every connection declares what this bundle needs and names only mechanics itself', async () => {
	const { registry, clients } = registryFor([hello('server-a')])
	registry.startPrimary('local')
	await settled(registry, (current) => current.primary?.phase === 'ready')
	const declared = clients.made[0].declared
	// The requirements travel in the hello through one declaration, so a
	// coarse capability literal cannot drift back in beside them.
	assert.deepEqual(
		declared.requiredCapabilities,
		CLIENT_SERVER_COMPATIBILITY.requiredCapabilities,
	)
	assert.deepEqual(
		declared.optionalCapabilities,
		CLIENT_SERVER_COMPATIBILITY.optionalCapabilities,
	)
	assert.deepEqual(clients.made[0].options.capabilities, [
		'server.health',
		'connection.heartbeat',
	])
	await registry.dispose()
})

test('a window runs one primary connection and attaches more', async () => {
	const { registry, opened } = registryFor([hello('server-a'), hello('server-b')])
	registry.startPrimary('local')
	registry.attach('build-box')
	const snapshot = await settled(
		registry,
		(current) =>
			current.connections.length === 2 &&
			current.connections.every((entry) => entry.phase === 'ready'),
	)
	assert.deepEqual(opened, ['local', 'build-box'])
	// The primary is always first in the order the strip groups by.
	assert.deepEqual(
		snapshot.connections.map((entry) => entry.role),
		['primary', 'attached'],
	)
	assert.equal(snapshot.primary.serverId, 'server-a')
	assert.equal(snapshot.byServerId.get('server-b').profileId, 'build-box')
	assert.equal(snapshot.connections[1].label, 'Label for build-box')
	// Each connection has its own agent store: a second server's agents are
	// never merged into the first's.
	assert.notEqual(
		snapshot.connections[0].agentStatusStore,
		snapshot.connections[1].agentStatusStore,
	)
	await registry.dispose()
})

test('attaching the same profile twice is a no-op, not a second connection', async () => {
	const { registry } = registryFor([hello('server-a'), hello('server-b')])
	registry.startPrimary('local')
	registry.attach('build-box')
	registry.attach('build-box')
	const snapshot = await settled(
		registry,
		(current) => current.connections.length === 2 &&
			current.connections.every((entry) => entry.phase === 'ready'),
	)
	assert.equal(snapshot.connections.length, 2)
	await registry.dispose()
})

test('two servers reporting the same project ids keep distinct connections', async () => {
	// Restored from one data-root copy: same ids, different servers.
	const { registry } = registryFor([hello('server-a'), hello('server-b')])
	registry.startPrimary('local')
	registry.attach('clone')
	const snapshot = await settled(
		registry,
		(current) => current.connections.length === 2 &&
			current.connections.every((entry) => entry.phase === 'ready'),
	)
	assert.equal(snapshot.byServerId.size, 2)
	assert.notEqual(
		snapshot.connections[0].context,
		snapshot.connections[1].context,
	)
	await registry.dispose()
})

test('a server missing a required capability is attached and inert', async () => {
	const { registry } = registryFor([
		hello('server-a'),
		hello('server-old', ['terminal.v1']),
	])
	registry.startPrimary('local')
	registry.attach('old-box')
	const snapshot = await settled(
		registry,
		(current) =>
			current.connections.length === 2 &&
			current.connections[1].phase === 'incompatible',
	)
	const old = snapshot.connections[1]
	// It stays attached, so its tabs stay in the strip.
	assert.equal(old.phase, 'incompatible')
	assert.equal(old.compatibility.state, 'incompatible')
	assert.equal(old.compatibility.upgrade, 'server')
	// No feature clients, which is what makes it take no operations.
	assert.equal(old.context, undefined)
	assert.match(old.error, /Update the server/)
	await registry.dispose()
})

test('a server missing an optional capability is degraded, not refused', async () => {
	const { registry } = registryFor([
		hello('server-a', [
			...CLIENT_SERVER_COMPATIBILITY.requiredCapabilities,
			...CLIENT_SERVER_COMPATIBILITY.optionalCapabilities.slice(1),
		]),
	])
	registry.startPrimary('local')
	const snapshot = await settled(
		registry,
		(current) => current.primary?.phase === 'ready',
	)
	assert.equal(snapshot.primary.compatibility.state, 'degraded')
	assert.ok(snapshot.primary.context !== undefined)
	await registry.dispose()
})

test('detaching drops the connection and never touches the primary', async () => {
	const { registry, clients } = registryFor([hello('server-a'), hello('server-b')])
	registry.startPrimary('local')
	registry.attach('build-box')
	await settled(
		registry,
		(current) => current.connections.length === 2 &&
			current.connections.every((entry) => entry.phase === 'ready'),
	)
	await registry.detach('build-box')
	assert.equal(registry.snapshot.connections.length, 1)
	assert.equal(registry.snapshot.byServerId.has('server-b'), false)
	// Detaching closes this window's client and nothing else.
	assert.equal(clients.made[1].closed, true)
	assert.equal(clients.made[0].closed, false)
	await assert.rejects(() => registry.detach('local'), /primary/)
	await registry.dispose()
})

test('a disposed registry can be started again, and attaches nothing meanwhile', async () => {
	// React StrictMode mounts, tears down, and mounts again, and leaving the
	// manager disposes the registry the shell then remounts. A second
	// `startPrimary` must not throw the whole shell away.
	const { registry } = registryFor([hello('server-a'), hello('server-a'), hello('server-b')])
	registry.startPrimary('local')
	await settled(registry, (current) => current.primary?.phase === 'ready')
	await registry.dispose()

	// Nothing may be attached to a registry that owns no connections: the entry
	// would have nothing left to tear it down.
	assert.equal(registry.attach('build-box'), undefined)
	assert.deepEqual(registry.snapshot.connections, [])

	registry.startPrimary('local')
	const revived = await settled(registry, (current) => current.primary?.phase === 'ready')
	assert.equal(revived.primary.profileId, 'local')
	registry.attach('build-box')
	await settled(
		registry,
		(current) => current.connections.length === 2,
	)
	await registry.dispose()
})
