import assert from 'node:assert/strict';
import test from 'node:test';
import { elsewhereTerminals } from './elsewhereTerminals.ts';

const terminal = (id: string, projectId: string, title?: string) => ({
	id,
	projectId,
	type: 'terminal' as const,
	sessionId: `s-${id}`,
	folderId: `f-${projectId}`,
	...(title === undefined ? {} : { title }),
});

const snapshot = {
	viewOrder: ['main', 'side'],
	views: {
		main: { id: 'main', name: 'Workspace', projectIds: ['here'] },
		side: { id: 'side', name: 'Project 1', projectIds: ['away', 'empty'] },
	},
	projects: {
		here: { id: 'here', name: 'Terminay', panelIds: ['h1'] },
		away: { id: 'away', name: 'Beta', color: '#f00', panelIds: ['a1', 'a-file'] },
		empty: { id: 'empty', name: 'Nothing running', panelIds: [] },
		'system:automations': { id: 'system:automations', name: 'Automations', kind: 'automations', panelIds: ['x1', 'x2'] },
	},
	panels: {
		h1: terminal('h1', 'here'),
		a1: terminal('a1', 'away', 'Worker'),
		'a-file': { id: 'a-file', projectId: 'away', type: 'file' as const },
		x1: terminal('x1', 'system:automations', 'Terminal 1'),
		x2: terminal('x2', 'system:automations'),
	},
	terminalSessions: {},
} as never;

test('every terminal this window does not show is listed, the automation space last', () => {
	const found = elsewhereTerminals(snapshot, new Set(['here']));
	assert.deepEqual(found.projects.map((project) => project.title), ['Beta · not in this window', 'Automations']);
	assert.deepEqual(found.placement, { away: 'other-view', 'system:automations': 'automations' });
	assert.deepEqual(found.inventoryByProject.away?.map((entry) => [entry.panelId, entry.title, entry.sessionId, entry.kind]), [
		['a1', 'Worker', 's-a1', 'terminal'],
	]);
	assert.deepEqual(found.inventoryByProject['system:automations']?.map((entry) => entry.title), ['Terminal 1', 'Terminal']);
});

test('a project this window shows, or one with no terminal, is not listed', () => {
	const found = elsewhereTerminals(snapshot, new Set(['here', 'away']));
	assert.deepEqual(found.projects.map((project) => project.id), ['system:automations']);
	assert.equal(found.inventoryByProject.empty, undefined);
	assert.equal(found.inventoryByProject.here, undefined);
});
