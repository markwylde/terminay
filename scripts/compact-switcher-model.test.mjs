import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	buildCompactSwitcherGroups,
	COMPACT_SWITCHER_PREVIEW_MAX_LENGTH,
	compactSwitcherIsEmpty,
	filterCompactSwitcherGroups,
	previewLineFromOutput,
} from '../src/workspace/compactSwitcherModel.ts';

const panel = (overrides) => ({
	color: '#7c5cff',
	emoji: '',
	isAgentStatus: false,
	kind: 'terminal',
	projectEmoji: '',
	projectId: 'p1',
	projectTitle: 'Paged',
	status: 'idle',
	...overrides,
});

const terminal = (panelId, title, sessionId, projectId = 'p1') =>
	panel({
		panelId,
		projectId,
		title,
		...(sessionId === undefined ? {} : { sessionId }),
	});

const source = (serverId, serverLabel, projects, inventoryByProject) => ({
	serverId,
	serverLabel,
	projects,
	inventoryByProject,
});

const paged = { color: '#7c5cff', emoji: '●', id: 'p1', title: 'Paged' };
const dotfiles = { color: '#4fd08a', emoji: '●', id: 'p2', title: 'dotfiles' };

const twoServers = [
	source('local', 'Marks-MacBook-Air', [paged, dotfiles], {
		p1: [
			terminal('panel-a', 'server', 's-a'),
			terminal('panel-b', 'build', 's-b'),
		],
		p2: [terminal('panel-c', 'zsh', 's-c', 'p2')],
	}),
	source('remote', 'paged-prod', [{ ...paged, id: 'p1', title: 'Paged' }], {
		p1: [terminal('panel-d', 'deploy', 's-d')],
	}),
];

test('groups by connection and then by project', () => {
	const groups = buildCompactSwitcherGroups({ sources: twoServers });
	assert.deepEqual(
		groups.map((connection) => connection.serverLabel),
		['Marks-MacBook-Air', 'paged-prod'],
	);
	assert.deepEqual(
		groups[0].projects.map((project) => project.title),
		['Paged', 'dotfiles'],
	);
	assert.deepEqual(
		groups[0].projects[0].terminals.map((row) => row.title),
		['server', 'build'],
	);
});

test('one attached connection still produces its heading', () => {
	const groups = buildCompactSwitcherGroups({ sources: [twoServers[0]] });
	assert.equal(groups.length, 1);
	assert.equal(groups[0].serverLabel, 'Marks-MacBook-Air');
	assert.equal(groups[0].projects.length, 2);
});

test('the same project id on two servers stays two groups', () => {
	const groups = buildCompactSwitcherGroups({ sources: twoServers });
	const keys = groups.flatMap((connection) =>
		connection.projects.map((project) => project.key),
	);
	assert.equal(new Set(keys).size, keys.length);
	const rows = groups.flatMap((connection) =>
		connection.projects.flatMap((project) => project.terminals),
	);
	for (const row of rows) {
		assert.ok(row.serverId === 'local' || row.serverId === 'remote');
	}
	assert.deepEqual(
		rows.filter((row) => row.serverId === 'remote').map((row) => row.title),
		['deploy'],
	);
});

test('non-terminal panels never become rows', () => {
	const groups = buildCompactSwitcherGroups({
		sources: [
			source('local', 'Local', [paged], {
				p1: [
					terminal('panel-a', 'server', 's-a'),
					panel({ kind: 'file', panelId: 'panel-file', title: 'README.md' }),
					panel({ kind: 'folder', panelId: 'panel-folder', title: 'src' }),
				],
			}),
		],
	});
	assert.deepEqual(
		groups[0].projects[0].terminals.map((row) => row.title),
		['server'],
	);
});

test('a project badge rides its group and hides at zero', () => {
	const groups = buildCompactSwitcherGroups({
		activityBadgesByProject: {
			'local:p1': { count: 2, state: 'recent' },
			'local:p2': { count: 0, state: 'unviewed' },
		},
		sources: [twoServers[0]],
	});
	assert.deepEqual(groups[0].projects[0].badge, { count: 2, state: 'recent' });
	assert.equal(groups[0].projects[1].badge, undefined);
});

test('preview comes from the window buffer, and is absent without one', () => {
	const groups = buildCompactSwitcherGroups({
		previewForSession: (sessionId) =>
			sessionId === 's-a' ? 'npm run build\n✓ built in 2.41s\n\n' : undefined,
		sources: [twoServers[0]],
	});
	assert.equal(groups[0].projects[0].terminals[0].preview, '✓ built in 2.41s');
	assert.equal(groups[0].projects[0].terminals[1].preview, undefined);
});

test('preview skips trailing blank lines and truncates to one line', () => {
	assert.equal(previewLineFromOutput('one\ntwo\n\n   \n'), 'two');
	assert.equal(previewLineFromOutput(''), undefined);
	assert.equal(previewLineFromOutput(undefined), undefined);
	const long = 'x'.repeat(COMPACT_SWITCHER_PREVIEW_MAX_LENGTH + 40);
	const preview = previewLineFromOutput(long);
	assert.equal(preview.length, COMPACT_SWITCHER_PREVIEW_MAX_LENGTH);
	assert.ok(preview.endsWith('…'));
});

test('resolving a preview changes no activity state', () => {
	const states = [];
	const groups = buildCompactSwitcherGroups({
		previewForSession: (sessionId) => {
			states.push(sessionId);
			return 'done';
		},
		sources: [twoServers[0]],
	});
	const rows = groups[0].projects.flatMap((project) => project.terminals);
	for (const row of rows) assert.equal(row.state, 'idle');
	assert.ok(states.length > 0);
});

test('filtering by terminal title keeps only that row', () => {
	const groups = filterCompactSwitcherGroups(
		buildCompactSwitcherGroups({ sources: twoServers }),
		'build',
	);
	assert.equal(groups.length, 1);
	assert.equal(groups[0].projects.length, 1);
	assert.deepEqual(
		groups[0].projects[0].terminals.map((row) => row.title),
		['build'],
	);
});

test('filtering by project name keeps the whole group', () => {
	const groups = filterCompactSwitcherGroups(
		buildCompactSwitcherGroups({ sources: twoServers }),
		'dotfiles',
	);
	assert.equal(groups.length, 1);
	assert.deepEqual(
		groups[0].projects[0].terminals.map((row) => row.title),
		['zsh'],
	);
});

test('filtering by connection name keeps every project of that server', () => {
	const groups = filterCompactSwitcherGroups(
		buildCompactSwitcherGroups({ sources: twoServers }),
		'paged-prod',
	);
	assert.equal(groups.length, 1);
	assert.equal(groups[0].serverLabel, 'paged-prod');
	assert.deepEqual(
		groups[0].projects[0].terminals.map((row) => row.title),
		['deploy'],
	);
});

test('a filter matching nothing empties the list', () => {
	const groups = filterCompactSwitcherGroups(
		buildCompactSwitcherGroups({ sources: twoServers }),
		'nothing-here',
	);
	assert.equal(groups.length, 0);
	assert.equal(compactSwitcherIsEmpty(groups), true);
});

test('clearing the filter restores the full list', () => {
	const all = buildCompactSwitcherGroups({ sources: twoServers });
	assert.deepEqual(filterCompactSwitcherGroups(all, '   '), all);
});
