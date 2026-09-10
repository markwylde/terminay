import assert from 'node:assert/strict'
import test from 'node:test'
import {
	buildComposition,
	compositionTabKey,
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
