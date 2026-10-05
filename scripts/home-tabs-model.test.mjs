import assert from 'node:assert/strict';
import test from 'node:test';
import {
	defaultHomeTabTitle,
	homeTabId,
	homeTabSection,
	homeTabServerId,
	parseHomeTabId,
	sanitizeHomeLayout,
} from '../src/workspace/homeTabs.ts';

/**
 * A Home tab is named by what it shows. One thing has one id, so opening what
 * is already open finds its tab; and an id read back from a device's memory
 * either names something Home knows or names nothing.
 */

const descriptors = [
	{ kind: 'section', section: 'home' },
	{ kind: 'section', section: 'tabs' },
	{ kind: 'section', section: 'automations' },
	{ kind: 'automation', serverId: 'server-a', automationId: 'auto-1' },
	{ kind: 'automation-edit', serverId: 'server-a', automationId: 'auto-1' },
	{ kind: 'automation-new', serverId: 'server-a', draftId: '4' },
	{ kind: 'run', serverId: 'server-a', automationId: 'auto-1', runId: 'run-9' },
	{ kind: 'automation-terminal', serverId: 'server-a', panelId: 'panel-2' },
];

test('every descriptor maps to one id and back', () => {
	const ids = descriptors.map(homeTabId);
	assert.equal(new Set(ids).size, ids.length);
	for (const descriptor of descriptors)
		assert.deepEqual(parseHomeTabId(homeTabId(descriptor)), descriptor);
});

test('ids survive separators inside the things they name', () => {
	const descriptor = {
		kind: 'run',
		serverId: 'https://host:8443/a',
		automationId: 'a:b',
		runId: 'run%20:1',
	};
	assert.deepEqual(parseHomeTabId(homeTabId(descriptor)), descriptor);
});

test('an id that names nothing Home knows is not a tab', () => {
	for (const id of [
		undefined,
		42,
		'',
		'section',
		'section:explorer',
		'section:tabs:extra',
		'automation:server-a',
		'automation:server-a:',
		'run:server-a:auto-1',
		'terminal:server-a:panel-1',
		'automation:%E0%A4%A:x',
	])
		assert.equal(parseHomeTabId(id), undefined, String(id));
});

test('a tab belongs to its section, and everything automation-shaped to Automations', () => {
	assert.deepEqual(descriptors.map(homeTabSection), [
		'home',
		'tabs',
		'automations',
		'automations',
		'automations',
		'automations',
		'automations',
		'automations',
	]);
	assert.equal(homeTabServerId(descriptors[0]), undefined);
	assert.equal(homeTabServerId(descriptors[3]), 'server-a');
	assert.equal(defaultHomeTabTitle(descriptors[1]), 'Tabs');
	assert.equal(defaultHomeTabTitle(descriptors[5]), 'New automation');
});

const leaf = (views, activeView = views[0]) => ({
	type: 'leaf',
	data: { views, activeView, id: views.join('|') },
	size: 400,
});
const layout = (children, panels = {}) => ({
	grid: {
		root: { type: 'branch', data: children, size: 600 },
		width: 800,
		height: 600,
		orientation: 'HORIZONTAL',
	},
	panels,
	activeGroup: 'g',
	floatingGroups: [{ data: leaf(['section:home']) }],
	popoutGroups: [{ data: leaf(['section:home']) }],
});

test('a split keeps its shape, and groups left empty are removed', () => {
	const sanitized = sanitizeHomeLayout(
		layout([
			leaf(['section:tabs']),
			{
				type: 'branch',
				data: [leaf(['automation-new:s:1']), leaf(['nonsense'])],
				size: 400,
			},
			leaf(['automation-new:s:2', 'run:s:a:r'], 'automation-new:s:2'),
		]),
	);
	assert.deepEqual(
		sanitized.grid.root.data.map((node) => node.data.views),
		[['section:tabs'], ['run:s:a:r']],
	);
	assert.equal(sanitized.grid.root.data[1].data.activeView, 'run:s:a:r');
	assert.equal(sanitized.floatingGroups, undefined);
	assert.equal(sanitized.popoutGroups, undefined);
});

test('a remembered title is kept, and nothing else stored beside a tab is', () => {
	const sanitized = sanitizeHomeLayout(
		layout([leaf(['automation:s:a', 'run:s:a:r'])], {
			'automation:s:a': {
				title: 'Nightly backup',
				contentComponent: 'file',
				params: { path: '/etc/passwd' },
			},
			'run:s:a:r': { title: 'x'.repeat(500) },
		}),
	);
	assert.deepEqual(sanitized.panels['automation:s:a'], {
		id: 'automation:s:a',
		contentComponent: 'home',
		tabComponent: 'homeTab',
		renderer: 'always',
		title: 'Nightly backup',
		params: {
			descriptor: { kind: 'automation', serverId: 's', automationId: 'a' },
		},
	});
	assert.equal(sanitized.panels['run:s:a:r'].title, 'Run');
});

test('nothing restorable is no arrangement', () => {
	for (const stored of [
		null,
		'text',
		[],
		{},
		{ grid: {} },
		{ grid: { root: leaf(['section:tabs']) } },
		layout([]),
		layout([leaf(['automation-new:s:1'])]),
		layout([{ type: 'leaf', data: { views: 'section:tabs' } }]),
	])
		assert.equal(sanitizeHomeLayout(stored), undefined);
});
