import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	buildCompactSwitcherGroups,
	COMPACT_SWITCHER_PREVIEW_MAX_LENGTH,
	compactSwitcherIsEmpty,
	filterCompactSwitcherGroups,
	formatCompactSwitcherSummary,
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
		groups[0].projects[0].panels.map((row) => row.title),
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
		connection.projects.flatMap((project) => project.panels),
	);
	for (const row of rows) {
		assert.ok(row.serverId === 'local' || row.serverId === 'remote');
	}
	assert.deepEqual(
		rows.filter((row) => row.serverId === 'remote').map((row) => row.title),
		['deploy'],
	);
});

test('file and folder panels become rows beside terminals', () => {
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
		groups[0].projects[0].panels.map((row) => [row.title, row.panelKind]),
		[
			['server', 'terminal'],
			['README.md', 'file'],
			['src', 'folder'],
		],
	);
});

test('filtering by file title keeps only that row', () => {
	const groups = filterCompactSwitcherGroups(
		buildCompactSwitcherGroups({
			sources: [
				source('local', 'Local', [paged], {
					p1: [
						terminal('panel-a', 'server', 's-a'),
						panel({ kind: 'file', panelId: 'panel-file', title: 'README.md' }),
					],
				}),
			],
		}),
		'README',
	);
	assert.deepEqual(
		groups[0].projects[0].panels.map((row) => row.title),
		['README.md'],
	);
});

const withStates = (states, extra = []) =>
	buildCompactSwitcherGroups({
		sources: [
			source('local', 'Local', [paged], {
				p1: [
					...states.map((status, index) => ({
						...terminal(`panel-${index}`, `t${index}`, `s-${index}`),
						status,
					})),
					...extra,
				],
			}),
		],
	})[0].projects[0];

test('a project summary counts its terminals by the state their rows present', () => {
	const project = withStates(['working', 'working', 'idle']);
	assert.deepEqual(project.summary, {
		attention: 0,
		working: 2,
		done: 0,
		idle: 1,
	});
	const shown = formatCompactSwitcherSummary(project.summary);
	assert.deepEqual(
		shown.groups.map((entry) => entry.text),
		['2 working', '1 idle'],
	);
	assert.equal(shown.groups[0].group, 'working');
});

test('waiting and blocked are one group, and it leads', () => {
	const one = formatCompactSwitcherSummary(
		withStates(['idle', 'working', 'waiting', 'idle', 'idle']).summary,
	);
	// Two groups fit beside a name; every group is still read out.
	assert.deepEqual(
		one.groups.map((entry) => entry.text),
		['1 needs you', '1 working'],
	);
	assert.equal(one.accessible, '1 needs you, 1 working, 3 idle');
	const two = formatCompactSwitcherSummary(
		withStates(['waiting', 'blocked', 'done']).summary,
	);
	assert.deepEqual(
		two.groups.map((entry) => entry.text),
		['2 need you', '1 done'],
	);
});

test('a project with no terminal has no summary to show', () => {
	const project = withStates([], [
		panel({ kind: 'file', panelId: 'panel-f', status: 'working', title: 'a.md' }),
	]);
	// A file panel is not activity, whatever status it was handed.
	assert.deepEqual(project.summary, {
		attention: 0,
		working: 0,
		done: 0,
		idle: 0,
	});
	const shown = formatCompactSwitcherSummary(project.summary);
	assert.deepEqual(shown.groups, []);
	assert.equal(shown.accessible, '');
});

test('a summary counts only its own server project', () => {
	const sources = [
		source('local', 'Local', [paged], {
			p1: [{ ...terminal('panel-a', 'server', 's-a'), status: 'working' }],
		}),
		source('remote', 'Remote', [paged], {
			p1: [terminal('panel-d', 'deploy', 's-d')],
		}),
	];
	const groups = buildCompactSwitcherGroups({ sources });
	assert.equal(groups[0].projects[0].summary.working, 1);
	assert.equal(groups[1].projects[0].summary.working, 0);
	assert.equal(groups[1].projects[0].summary.idle, 1);
});

test('a filter narrows the rows and leaves the summary describing the project', () => {
	const project = withStates(['working', 'idle']);
	const [filtered] = filterCompactSwitcherGroups(
		[{ projects: [project], serverId: 'local', serverLabel: 'Local' }],
		't1',
	)[0].projects;
	assert.deepEqual(
		filtered.panels.map((row) => row.title),
		['t1'],
	);
	assert.deepEqual(filtered.summary, project.summary);
});

test('preview comes from the window buffer, and is absent without one', () => {
	const groups = buildCompactSwitcherGroups({
		previewForSession: (sessionId) =>
			sessionId === 's-a' ? 'npm run build\n✓ built in 2.41s\n\n' : undefined,
		sources: [twoServers[0]],
	});
	assert.equal(groups[0].projects[0].panels[0].preview, '✓ built in 2.41s');
	assert.equal(groups[0].projects[0].panels[1].preview, undefined);
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
	const rows = groups[0].projects.flatMap((project) => project.panels);
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
		groups[0].projects[0].panels.map((row) => row.title),
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
		groups[0].projects[0].panels.map((row) => row.title),
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
		groups[0].projects[0].panels.map((row) => row.title),
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

/** Paged with General holding the server, a linked folder holding the build
 * and a file, and an empty linked folder. */
const withFolders = () =>
	buildCompactSwitcherGroups({
		foldersByProject: {
			'local:p1': [
				{ id: 'general', name: 'General' },
				{ id: 'release', name: 'release-notes' },
				{ id: 'idle', name: 'one-window' },
			],
		},
		sources: [
			source('local', 'Local', [paged, dotfiles], {
				p1: [
					{ ...terminal('panel-a', 'server', 's-a'), folderId: 'general' },
					{ ...terminal('panel-b', 'build', 's-b'), folderId: 'release' },
					panel({
						folderId: 'release',
						kind: 'file',
						panelId: 'file-1',
						title: 'README.md',
					}),
				],
				p2: [terminal('panel-c', 'zsh', 's-c', 'p2')],
			}),
		],
	});

test('each project lists its folders, each folder its panels', () => {
	const [project, unfoldered] = withFolders()[0].projects;
	assert.deepEqual(
		project.folders.map((folder) => [
			folder.name,
			folder.panels.map((row) => row.title),
		]),
		[
			['General', ['server']],
			['release-notes', ['build', 'README.md']],
			['one-window', []],
		],
	);
	// The flat list is still every panel, for the surfaces that read it.
	assert.deepEqual(
		project.panels.map((row) => row.title),
		['server', 'build', 'README.md'],
	);
	assert.equal(project.folders[1].panels[0].folderId, 'release');
	assert.equal(new Set(project.folders.map((folder) => folder.key)).size, 3);
	// A project whose folders this window does not know has none to list.
	assert.deepEqual(unfoldered.folders, []);
	assert.deepEqual(
		unfoldered.panels.map((row) => row.title),
		['zsh'],
	);
});

test('a panel in an unknown folder stays reachable under the first', () => {
	const groups = buildCompactSwitcherGroups({
		foldersByProject: { 'local:p1': [{ id: 'general', name: 'General' }] },
		sources: [
			source('local', 'Local', [paged], {
				p1: [
					terminal('panel-a', 'server', 's-a'),
					{ ...terminal('panel-b', 'build', 's-b'), folderId: 'gone' },
				],
			}),
		],
	});
	assert.deepEqual(
		groups[0].projects[0].folders[0].panels.map((row) => row.title),
		['server', 'build'],
	);
});

test('filtering narrows folders with their panels', () => {
	const byPanel = filterCompactSwitcherGroups(withFolders(), 'readme');
	const [project] = byPanel[0].projects;
	assert.deepEqual(
		project.folders.map((folder) => folder.name),
		['release-notes'],
	);
	assert.deepEqual(
		project.panels.map((row) => row.title),
		['README.md'],
	);

	// A folder's name keeps the folder whole, as a project's keeps the project.
	const byFolder = filterCompactSwitcherGroups(withFolders(), 'release-n');
	assert.deepEqual(
		byFolder[0].projects[0].panels.map((row) => row.title),
		['build', 'README.md'],
	);
	// An empty folder is still found by its name.
	const empty = filterCompactSwitcherGroups(withFolders(), 'one-window');
	assert.deepEqual(
		empty[0].projects[0].folders.map((folder) => folder.name),
		['one-window'],
	);
	assert.deepEqual(empty[0].projects[0].panels, []);
});
