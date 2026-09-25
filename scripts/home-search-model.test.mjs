import assert from 'node:assert/strict';
import test from 'node:test';
import {
	HOME_SEARCH_GROUP_LIMIT,
	matchRank,
	searchHome,
} from '../src/workspace/homeSearchModel.ts';

/**
 * Home's search finds places to go: Home's sections, every project, tab, and
 * agent of every attached server, and every automation. It matches the way the
 * dashboard filter does — case-insensitive substrings — and ranks a match at
 * the start of a name, or of a word, above one in the middle.
 */

function agent(entryId, name, overrides = {}) {
	return {
		activationTerminalSessionId: `session-${entryId}`,
		entryId,
		external: false,
		name,
		provider: 'claude',
		state: 'working',
		stateStartedAt: 0,
		subagentCount: 0,
		subagents: [],
		unread: false,
		...overrides,
	};
}

function group(serverId, projectId, title, panels = [], serverLabel) {
	return {
		serverId,
		key: `${serverId}:${projectId}`,
		...(serverLabel === undefined ? {} : { serverLabel }),
		row: {
			detachedAgents: [],
			panels: panels.map(([panelId, panelTitle, agents = []]) => ({
				agents,
				color: '#336699',
				emoji: '',
				isAgentStatus: agents.length > 0,
				kind: 'panel',
				panelId,
				panelKind: 'terminal',
				projectId,
				status: 'idle',
				title: panelTitle,
			})),
			project: {
				color: '#336699',
				counts: {},
				emoji: '',
				kind: 'project',
				projectId,
				title,
			},
		},
	};
}

const groups = [
	group('local', 'p1', 'Terminay', [
		['t1', 'Terminal 1'],
		['t2', 'dev server', [agent('a1', 'Fix merge conflicts', { subagents: [agent('a2', 'Rebase helper')] })]],
	]),
	group('local', 'p2', 'Website', [['t3', 'Terminal 2']]),
];
const automations = [
	{ serverId: 'local', id: 'x1', name: 'Hourly report', detail: 'Every hour, on the hour' },
];

test('an empty or blank query has no results', () => {
	assert.deepEqual(searchHome(groups, automations, ''), []);
	assert.deepEqual(searchHome(groups, automations, '   '), []);
});

test('results are grouped: sections, projects, tabs, agents, automations', () => {
	const kinds = searchHome(groups, automations, 'e').map((result) => result.kind);
	const order = ['section', 'project', 'panel', 'agent', 'automation'];
	const firstIndex = order.map((kind) => kinds.indexOf(kind)).filter((i) => i !== -1);
	assert.deepEqual(firstIndex, [...firstIndex].sort((a, b) => a - b));
});

test('matching is case-insensitive and finds tabs with their project as detail', () => {
	const results = searchHome(groups, automations, 'TERMINAL 2');
	assert.equal(results.length, 1);
	assert.equal(results[0].kind, 'panel');
	assert.equal(results[0].title, 'Terminal 2');
	assert.equal(results[0].detail, 'Website');
});

test('agents and their subagents are found by name, with where they run', () => {
	const results = searchHome(groups, automations, 'rebase');
	assert.deepEqual(
		results.map((result) => [result.kind, result.title, result.detail]),
		[['agent', 'Rebase helper', 'Terminay · dev server']],
	);
	assert.equal(results[0].projectId, 'p1');
});

test('automations match by name or trigger; sections by label', () => {
	assert.deepEqual(
		searchHome(groups, automations, 'every hour').map((result) => result.title),
		['Hourly report'],
	);
	assert.deepEqual(
		searchHome(groups, automations, 'autom').map((result) => [result.kind, result.title]),
		[['section', 'Automations']],
	);
});

test('a match at the start of a name or word ranks first', () => {
	assert.equal(matchRank('Terminal', 'term'), 0);
	assert.equal(matchRank('dev server', 'serv'), 1);
	assert.equal(matchRank('observer', 'serv'), 2);
	assert.equal(matchRank('observer', 'xyz'), undefined);
	const titles = searchHome(
		[group('local', 'p', 'P', [['a', 'observer'], ['b', 'server']])],
		[],
		'serv',
	).map((result) => result.title);
	assert.deepEqual(titles, ['server', 'observer']);
});

test('each group is capped so one busy kind cannot bury the others', () => {
	const many = Array.from({ length: 20 }, (_, index) => [`t${index}`, `Terminal ${index}`]);
	const results = searchHome([group('local', 'p', 'Project', many)], [], 'terminal');
	assert.equal(results.filter((result) => result.kind === 'panel').length, HOME_SEARCH_GROUP_LIMIT);
});

test('projects from two servers stay apart and name their server', () => {
	const results = searchHome(
		[group('a', 'p', 'Shared', [], 'Laptop'), group('b', 'p', 'Shared', [], 'Desktop')],
		[],
		'shared',
	);
	assert.deepEqual(
		results.map((result) => [result.serverId, result.detail]),
		[['a', 'Laptop'], ['b', 'Desktop']],
	);
	assert.notEqual(results[0].key, results[1].key);
});
