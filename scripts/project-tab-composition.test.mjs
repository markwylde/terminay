import assert from 'node:assert/strict'
import test from 'node:test'
import {
	buildComposition,
	compositionTabKey,
	createCompositionSession,
	createLocalCompositionPersistence,
	moveCompositionTab,
	normalizeComposition,
	orderCompositionTabs,
	parseCompositionTabKey,
} from '../src/shared/connections/composition.ts'
import {
	canMovePanelToProject,
	composeProjectTabs,
	panelMoveTargets,
	projectTabSourceFor,
	shouldNameServers,
} from '../src/workspace/projectTabComposition.ts'

function project(serverId, id, title = id) {
	return { id, serverId, title, color: '#000000', emoji: '', rootFolder: '/' }
}

function source(serverId, label, projects, overrides = {}) {
	return { serverId, serverLabel: label, usable: true, projects, ...overrides }
}

test('two servers whose project ids collide both render a tab', () => {
	// Two servers restored from one data-root copy hand out the same ids.
	const composed = composeProjectTabs([
		source('server-a', 'Laptop', [project('server-a', 'project-1', 'Left')]),
		source('server-b', 'Build box', [
			project('server-b', 'project-1', 'Right'),
		]),
	])
	assert.equal(composed.length, 2)
	assert.deepEqual(
		composed.map((tab) => tab.handle),
		['server-a:project-1', 'server-b:project-1'],
	)
	assert.deepEqual(
		composed.map((tab) => tab.title),
		['Left', 'Right'],
	)
	assert.deepEqual(
		composed.map((tab) => tab.serverLabel),
		['Laptop', 'Build box'],
	)
})

test('the remembered order interleaves servers and survives a missing tab', () => {
	const composed = composeProjectTabs(
		[
			source('a', 'A', [project('a', 'one'), project('a', 'two')]),
			source('b', 'B', [project('b', 'one')]),
		],
		[
			{ serverId: 'b', projectId: 'one' },
			{ serverId: 'a', projectId: 'gone' },
			{ serverId: 'a', projectId: 'two' },
		],
	)
	assert.deepEqual(
		composed.map((tab) => tab.handle),
		['b:one', 'a:two', 'a:one'],
	)
})

test('an unusable server keeps its tabs, greyed and inert', () => {
	const composed = composeProjectTabs([
		source('a', 'A', [project('a', 'one')]),
		source('b', 'B', [project('b', 'one')], {
			usable: false,
			statusMessage: 'Server 1.2 speaks protocol 1; update the server.',
		}),
	])
	assert.deepEqual(
		composed.map((tab) => tab.inert),
		[false, true],
	)
	assert.equal(
		composed[1].statusMessage,
		'Server 1.2 speaks protocol 1; update the server.',
	)
})

test('a tab claiming another server id is dropped, not re-homed', () => {
	const composed = composeProjectTabs([
		source('a', 'A', [project('b', 'forged'), project('a', 'real')]),
	])
	assert.deepEqual(
		composed.map((tab) => tab.handle),
		['a:real'],
	)
})

test('the server is named only when more than one is attached', () => {
	assert.equal(shouldNameServers([source('a', 'A', [])]), false)
	assert.equal(
		shouldNameServers([source('a', 'A', []), source('b', 'B', [])]),
		true,
	)
})

test('a panel is never offered a project on another server', () => {
	const from = project('a', 'one')
	const candidates = [
		project('a', 'one'),
		project('a', 'two'),
		project('b', 'two'),
	]
	assert.equal(canMovePanelToProject(from, project('b', 'two')), false)
	assert.equal(canMovePanelToProject(from, project('a', 'two')), true)
	// Its own project is not a move target either.
	assert.equal(canMovePanelToProject(from, project('a', 'one')), false)
	assert.deepEqual(
		panelMoveTargets(from, candidates).map((tab) => `${tab.serverId}:${tab.id}`),
		['a:two'],
	)
})

test('a connection is a usable source only while it is ready', () => {
	const base = {
		profileId: 'p',
		role: 'attached',
		label: 'Build box',
		serverId: 'b',
		agentStatusStore: {},
		retry: () => {},
	}
	assert.equal(
		projectTabSourceFor({ ...base, phase: 'ready' }, []).usable,
		true,
	)
	const incompatible = projectTabSourceFor(
		{
			...base,
			phase: 'incompatible',
			compatibility: {
				state: 'incompatible',
				reason: 'protocol',
				upgrade: 'server',
				message: 'Update the server.',
			},
		},
		[],
	)
	assert.equal(incompatible.usable, false)
	assert.equal(incompatible.statusMessage, 'Update the server.')
	const unreachable = projectTabSourceFor(
		{ ...base, phase: 'unreachable' },
		[],
	)
	assert.equal(unreachable.usable, false)
	assert.equal(unreachable.statusMessage, 'This server is unreachable.')
	// A connection that has not said hello contributes nothing at all.
	assert.equal(
		projectTabSourceFor({ ...base, serverId: undefined, phase: 'connecting' }, []),
		undefined,
	)
})

test('tab handles escape both halves so one server cannot forge another', () => {
	const key = compositionTabKey('server:a', 'project:1')
	assert.deepEqual(parseCompositionTabKey(key), {
		serverId: 'server:a',
		projectId: 'project:1',
	})
	assert.notEqual(key, compositionTabKey('server', 'a:project:1'))
})

test('moving a tab keeps every other tab in order', () => {
	const order = [
		{ serverId: 'a', projectId: 'one' },
		{ serverId: 'b', projectId: 'one' },
		{ serverId: 'a', projectId: 'two' },
	]
	const moved = moveCompositionTab(order, { serverId: 'a', projectId: 'two' }, 0)
	assert.deepEqual(
		moved.map((tab) => `${tab.serverId}:${tab.projectId}`),
		['a:two', 'a:one', 'b:one'],
	)
})

test('a composition round-trips through storage and rejects a malformed one', () => {
	const composition = buildComposition(
		'local',
		[{ profileId: 'build-box', viewId: 'view-1' }],
		[{ serverId: 'a', projectId: 'one' }],
	)
	assert.deepEqual(
		normalizeComposition(JSON.parse(JSON.stringify(composition))),
		composition,
	)
	assert.equal(normalizeComposition({ version: 2 }), undefined)
	assert.equal(normalizeComposition({ version: 1, primaryProfileId: 1 }), undefined)
	assert.equal(normalizeComposition('nonsense'), undefined)
})

test('every project of a connection renders, however stale the remembered order', () => {
	// The strip once dropped every tab the remembered order did not name.
	// Twenty projects, an order that knows two of them, and one entry for a
	// project that no longer exists.
	const projects = Array.from({ length: 20 }, (_, index) =>
		project('a', `project-${index + 1}`, `Project ${index + 1}`),
	)
	const composed = composeProjectTabs(
		[source('a', 'Local', projects)],
		[
			{ serverId: 'a', projectId: 'project-7' },
			{ serverId: 'a', projectId: 'gone' },
			{ serverId: 'a', projectId: 'project-2' },
		],
	)
	assert.equal(composed.length, 20)
	// Remembered tabs lead, in the remembered order; the rest keep server order.
	assert.deepEqual(
		composed.slice(0, 4).map((tab) => tab.id),
		['project-7', 'project-2', 'project-1', 'project-3'],
	)
	assert.equal(new Set(composed.map((tab) => tab.handle)).size, projects.length)
})

test('a composition that names nothing keeps the server order exactly', () => {
	const projects = Array.from({ length: 12 }, (_, index) =>
		project('a', `project-${index + 1}`),
	)
	const composed = composeProjectTabs([source('a', 'Local', projects)], [])
	assert.deepEqual(
		composed.map((tab) => tab.id),
		projects.map((tab) => tab.id),
	)
})

test('a reorder is kept even when the server still reports the old order', () => {
	const server = [
		project('a', 'project-1', 'Project'),
		project('a', 'project-2', 'Project 2'),
	]
	// The person drags the second tab in front of the first.
	const reordered = moveCompositionTab(
		server.map((tab) => ({ serverId: tab.serverId, projectId: tab.id })),
		{ serverId: 'a', projectId: 'project-2' },
		0,
	)
	// The next snapshot arrives in the server's own order and must not undo it.
	const composed = composeProjectTabs([source('a', 'Local', server)], reordered)
	assert.deepEqual(
		composed.map((tab) => tab.title),
		['Project 2', 'Project'],
	)
})

test('ordering keeps unremembered tabs in their own order at the end', () => {
	const ordered = orderCompositionTabs(
		[
			{ serverId: 'a', projectId: 'one' },
			{ serverId: 'a', projectId: 'two' },
			{ serverId: 'b', projectId: 'one' },
		],
		[{ serverId: 'a', projectId: 'two' }],
	)
	assert.deepEqual(
		ordered.map((tab) => `${tab.serverId}:${tab.projectId}`),
		['a:two', 'a:one', 'b:one'],
	)
})

function fakeStorage(initial = {}) {
	const items = new Map(Object.entries(initial))
	return {
		getItem: (key) => (items.has(key) ? items.get(key) : null),
		setItem: (key, value) => items.set(key, value),
		read: (key) => items.get(key),
	}
}

const TWO_ATTACHED = buildComposition(
	'local',
	[{ profileId: 'build-box' }, { profileId: 'vps' }],
	[{ serverId: 'server-a', projectId: 'project-1' }],
)

test('a stored composition with two attached profiles survives a mount', async () => {
	const storage = fakeStorage({
		'terminay.workspace.composition.v1:server-a': JSON.stringify(TWO_ATTACHED),
	})
	const persistence = createLocalCompositionPersistence('server-a', storage)
	const session = createCompositionSession(persistence)

	// A window mounts with nothing attached yet, so its first idea of its own
	// composition is empty. Writing that before the record is read is what used
	// to wipe every attached server.
	assert.equal(session.persist(buildComposition('local', [], [])), false)
	assert.equal(session.restored, false)

	const attached = []
	await session.restore((restored) => {
		for (const entry of restored.attached) attached.push(entry.profileId)
	})
	assert.deepEqual(attached, ['build-box', 'vps'])
	assert.equal(session.restored, true)

	// The record is intact on disk: the refused write left it alone.
	assert.deepEqual(
		JSON.parse(storage.read('terminay.workspace.composition.v1:server-a'))
			.attached,
		[{ profileId: 'build-box' }, { profileId: 'vps' }],
	)

	// Once restored, the window persists what it actually holds.
	assert.equal(session.persist(TWO_ATTACHED), true)
	assert.deepEqual(
		await createLocalCompositionPersistence('server-a', storage).read(),
		TWO_ATTACHED,
	)
})

test('changing where the composition lives re-closes the restore gate', async () => {
	const storage = fakeStorage({
		'terminay.workspace.composition.v1:server-a': JSON.stringify(TWO_ATTACHED),
	})
	// A window starts with no persistence at all and takes a real store once its
	// primary knows its server. The second session has restored nothing yet.
	const first = createCompositionSession({
		read: async () => undefined,
		write: async () => undefined,
	})
	await first.restore(() => assert.fail('nothing to restore'))
	assert.equal(first.restored, true)

	const second = createCompositionSession(
		createLocalCompositionPersistence('server-a', storage),
	)
	assert.equal(second.persist(buildComposition('local', [], [])), false)
	assert.deepEqual(
		JSON.parse(storage.read('terminay.workspace.composition.v1:server-a'))
			.attached,
		[{ profileId: 'build-box' }, { profileId: 'vps' }],
	)
})

test('a composition that cannot be read still lets the window persist one', async () => {
	const session = createCompositionSession({
		read: async () => {
			throw new Error('storage is gone')
		},
		write: async () => undefined,
	})
	await session.restore(() => assert.fail('nothing to restore'))
	assert.equal(session.persist(buildComposition('local', [], [])), true)
})
