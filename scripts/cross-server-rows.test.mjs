import assert from 'node:assert/strict'
import test from 'node:test'
import {
	activityBadgesByServer,
	buildCrossServerAgentRows,
	buildCrossServerDashboardRows,
	namesServers,
	scopeRowsByServer,
	summarizeCrossServerActivityBadge,
} from '../src/workspace/crossServerRows.ts'
import {
	resolveSelectedServer,
	selectableConnections,
} from '../src/shared/connections/serverSelection.ts'

function inventoryEntry(panelId, status = 'idle') {
	return {
		panelId,
		kind: 'terminal',
		title: panelId,
		color: '#000000',
		emoji: '',
		isAgentStatus: false,
		status,
		sessionId: `session-${panelId}`,
	}
}

function dashboardSource(serverId, label) {
	return {
		serverId,
		serverLabel: label,
		// Both servers use the same project id: they were restored from one copy.
		projects: [{ id: 'project-1', title: 'Work', color: '#111111', emoji: '' }],
		inventoryByProject: { 'project-1': [inventoryEntry('panel-1')] },
	}
}

test('the dashboard aggregates two servers and keys every row by server', () => {
	const rows = buildCrossServerDashboardRows([
		dashboardSource('a', 'Laptop'),
		dashboardSource('b', 'Build box'),
	])
	assert.equal(rows.length, 4)
	assert.equal(new Set(rows.map((row) => row.key)).size, 4)
	assert.deepEqual(
		rows.map((row) => row.serverLabel),
		['Laptop', 'Laptop', 'Build box', 'Build box'],
	)
	// Counts stay per server; nothing is summed across them.
	assert.equal(rows[0].row.counts.panels, 1)
})

test('one attached server leaves rows unnamed', () => {
	const rows = buildCrossServerDashboardRows([dashboardSource('a', 'Laptop')])
	assert.equal(namesServers([{ serverId: 'a' }]), false)
	assert.deepEqual(
		rows.map((row) => row.serverLabel),
		[undefined, undefined],
	)
	assert.deepEqual(
		rows.map((row) => row.serverId),
		['a', 'a'],
	)
})

test('the header badge totals across servers and takes the most urgent state', () => {
	const badge = summarizeCrossServerActivityBadge([
		{ serverId: 'a', serverLabel: 'Laptop', rows: ['working', 'unviewed'] },
		{ serverId: 'b', serverLabel: 'Build box', rows: ['waiting'] },
	])
	assert.deepEqual(badge, { count: 3, state: 'attention' })
	assert.equal(
		summarizeCrossServerActivityBadge([
			{ serverId: 'a', serverLabel: 'Laptop', rows: [] },
		]),
		null,
	)
})

test('per-server badges omit servers with nothing to report', () => {
	const badges = activityBadgesByServer([
		{ serverId: 'a', serverLabel: 'Laptop', rows: ['working'] },
		{ serverId: 'b', serverLabel: 'Build box', rows: [] },
	])
	assert.deepEqual(badges, [
		{ serverId: 'a', serverLabel: 'Laptop', badge: { count: 1, state: 'recent' } },
	])
})

test('agent rows from two servers keep colliding entry ids apart', () => {
	const item = (projectId, entryId) => ({
		projectId,
		entry: { entryId, kind: 'root' },
	})
	const rows = buildCrossServerAgentRows([
		{ serverId: 'a', serverLabel: 'Laptop', rows: [item('project-1', 'agent-1')] },
		{
			serverId: 'b',
			serverLabel: 'Build box',
			rows: [item('project-1', 'agent-1')],
		},
	])
	assert.equal(rows.length, 2)
	assert.notEqual(rows[0].key, rows[1].key)
	assert.deepEqual(
		rows.map((row) => row.serverId),
		['a', 'b'],
	)
})

test('row keys escape their halves so one server cannot forge another', () => {
	const rows = scopeRowsByServer(
		[
			{ serverId: 'a:b', serverLabel: 'One', rows: ['c'] },
			{ serverId: 'a', serverLabel: 'Two', rows: ['b:c'] },
		],
		(row) => row,
	)
	assert.notEqual(rows[0].key, rows[1].key)
})

test('a per-server surface defaults to the active tab server and never merges', () => {
	const connection = (serverId, ready = true) => ({
		profileId: `p-${serverId}`,
		serverId,
		label: serverId,
		phase: ready ? 'ready' : 'unreachable',
		...(ready ? { context: { serverId } } : {}),
	})
	const connections = [connection('a'), connection('b'), connection('c', false)]
	// Inert servers are not selectable: they can answer nothing.
	assert.deepEqual(
		selectableConnections(connections).map((entry) => entry.serverId),
		['a', 'b'],
	)
	// The default is the active tab's server.
	assert.equal(resolveSelectedServer(connections, undefined, 'b').serverId, 'b')
	// An explicit choice wins over the default.
	assert.equal(resolveSelectedServer(connections, 'a', 'b').serverId, 'a')
	// A choice that is no longer usable falls back rather than showing nothing.
	assert.equal(resolveSelectedServer(connections, 'c', 'b').serverId, 'b')
	assert.equal(resolveSelectedServer(connections, 'c', 'c').serverId, 'a')
})
