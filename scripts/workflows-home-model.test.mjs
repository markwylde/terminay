import assert from 'node:assert/strict';
import test from 'node:test';
import {
	applyWorkflowsHomeView,
	buildWorkflowRows,
	isHighlighted,
	needsYouCount,
	UNRESTORABLE_WORKFLOW_NAME,
	workflowTone,
} from '../src/workspace/workflows/workflowsHomeModel.ts';
import {
	DEFAULT_WORKFLOWS_HOME_VIEW,
	isDefaultWorkflowsHomeView,
	parseWorkflowsHomeView,
	readWorkflowsHomeView,
	WORKFLOWS_HOME_VIEW_KEY,
	writeWorkflowsHomeView,
} from '../src/workspace/workflows/workflowsHomeView.ts';

const step = (id, status, extra = {}) => ({
	id,
	title: `Step ${id}`,
	prompt: '',
	icon: '',
	status,
	note: '',
	startedAt: null,
	endedAt: null,
	...extra,
});
const attached = (sessionId, name, steps) => ({
	sessionId,
	state: 'attached',
	workflow: { id: `wf-${sessionId}`, name, openingPrompt: '', templateId: null, createdAt: 0, steps },
	resumeStepId: null,
	unfinished: true,
});
const terminal = (panelId, title = panelId) => ({
	panelId,
	kind: 'terminal',
	title,
	color: '#000000',
	emoji: '',
	isAgentStatus: false,
	status: 'idle',
	sessionId: `session-${panelId}`,
});
const source = (serverId, projects) => ({
	serverId,
	serverLabel: serverId,
	projects: projects.map(([id, title]) => ({ id, title, color: '#123456', emoji: '' })),
	inventoryByProject: Object.fromEntries(projects.map(([id, , panels]) => [id, panels])),
});
const server = (...views) => ({ workflows: new Map(views.map((view) => [view.sessionId, view])) });
const view = (overrides = {}) => ({ ...DEFAULT_WORKFLOWS_HOME_VIEW, ...overrides });

// A window: project A with two terminals that have workflows and one that has
// none; project B with one.
const sources = [
	source('s1', [
		['a', 'Alpha', [terminal('a1', 'claude · pairing'), terminal('a2'), terminal('a3')]],
		['b', 'Beta', [terminal('b1')]],
	]),
];
const workflows = new Map([
	[
		's1',
		server(
			attached('session-a1', 'OpenSpec', [
				step('1', 'done', { startedAt: 1000, endedAt: 2000 }),
				step('2', 'running', { startedAt: 3000 }),
			]),
			attached('session-a2', 'Release', [step('1', 'failed', { startedAt: 500, endedAt: 900 })]),
			attached('session-b1', 'OpenSpec', [
				step('1', 'done', { startedAt: 100, endedAt: 200 }),
				step('2', 'done', { startedAt: 200, endedAt: 400 }),
			]),
			// No dashboard panel holds this session.
			attached('session-elsewhere', 'Hidden', [step('1', 'running')]),
		),
	],
]);
const rows = buildWorkflowRows(sources, workflows);

test('1.1 workflows join to the dashboard rows of their terminals', () => {
	assert.deepEqual(
		rows.map((row) => [row.key, row.projectTitle, row.terminalTitle, row.name]),
		[
			['s1:session-a1', 'Alpha', 'claude · pairing', 'OpenSpec'],
			['s1:session-a2', 'Alpha', 'a2', 'Release'],
			['s1:session-b1', 'Beta', 'b1', 'OpenSpec'],
		],
	);
	assert.equal(rows[0].panel.panelId, 'a1');
	assert.equal(rows[0].lastChange, 3000);
	assert.equal(rows[0].done, 1);
	assert.equal(rows[0].fraction, 0.5);
});

test('1.1 a workflow whose terminal the dashboard does not list is dropped', () => {
	assert.equal(rows.some((row) => row.sessionId === 'session-elsewhere'), false);
});

test('1.1 the same session id on two servers stays two rows', () => {
	const two = buildWorkflowRows(
		[source('x', [['p', 'P', [terminal('t')]]]), source('y', [['p', 'P', [terminal('t')]]])],
		new Map([
			['x', server(attached('session-t', 'One', [step('1', 'running')]))],
			['y', server(attached('session-t', 'Two', [step('1', 'done')]))],
		]),
	);
	assert.deepEqual(
		two.map((row) => [row.key, row.name, row.projectKey]),
		[
			['x:session-t', 'One', 'x:p'],
			['y:session-t', 'Two', 'y:p'],
		],
	);
});

test('1.1 tones, including failed beside running and unrestorable', () => {
	assert.equal(workflowTone(attached('s', 'n', [step('1', 'failed'), step('2', 'running')])), 'alert');
	assert.equal(workflowTone(attached('s', 'n', [step('1', 'needs_input')])), 'alert');
	assert.equal(workflowTone(attached('s', 'n', [step('1', 'done'), step('2', 'running')])), 'running');
	assert.equal(workflowTone(attached('s', 'n', [step('1', 'done')])), 'done');
	assert.equal(workflowTone(attached('s', 'n', [step('1', 'done'), step('2', 'not_started')])), 'idle');
	assert.equal(workflowTone({ sessionId: 's', state: 'unrestorable' }), 'alert');
	assert.deepEqual(
		['running', 'needs_input', 'failed', 'done', 'not_started'].map(isHighlighted),
		[true, true, true, false, false],
	);
});

test('1.1 an unrestorable workflow is named and needs the user', () => {
	const [row] = buildWorkflowRows(
		[source('s', [['p', 'Proj', [terminal('t', 'build')]]])],
		new Map([['s', server({ sessionId: 'session-t', state: 'unrestorable' })]]),
	);
	assert.equal(row.name, UNRESTORABLE_WORKFLOW_NAME);
	assert.equal(row.tone, 'alert');
	assert.equal(row.total, 0);
	assert.equal(applyWorkflowsHomeView([row], view({ text: 'build' })).shown.length, 1);
	assert.equal(applyWorkflowsHomeView([row], view({ text: 'proj' })).shown.length, 1);
});

test('1.2 the text filter matches name, terminal title, and project, ignoring case', () => {
	assert.deepEqual(applyWorkflowsHomeView(rows, view({ text: 'PAIRING' })).shown.map((r) => r.key), ['s1:session-a1']);
	assert.deepEqual(applyWorkflowsHomeView(rows, view({ text: 'release' })).shown.map((r) => r.key), ['s1:session-a2']);
	assert.deepEqual(applyWorkflowsHomeView(rows, view({ text: 'beta' })).shown.map((r) => r.key), ['s1:session-b1']);
	assert.equal(applyWorkflowsHomeView(rows, view({ text: 'beta' })).total, 3);
});

test('1.2 status filters combine, and none means every status', () => {
	assert.equal(applyWorkflowsHomeView(rows, view()).shown.length, 3);
	assert.deepEqual(
		applyWorkflowsHomeView(rows, view({ statuses: ['alert', 'running'] })).shown.map((r) => r.tone),
		['alert', 'running'],
	);
	assert.deepEqual(applyWorkflowsHomeView(rows, view({ statuses: ['done'] })).shown.map((r) => r.tone), ['done']);
});

test('1.2 leaving a project out hides it and narrows the counts', () => {
	const model = applyWorkflowsHomeView(rows, view({ excludedProjects: ['s1:a'] }));
	assert.deepEqual(model.shown.map((r) => r.projectTitle), ['Beta']);
	assert.deepEqual(model.statusCounts, { alert: 0, running: 0, done: 1 });
	assert.deepEqual(
		model.projects.map((p) => [p.title, p.count, p.included]),
		[
			['Alpha', 2, false],
			['Beta', 1, true],
		],
	);
});

test('1.2 a project the device has not seen is included', () => {
	const model = applyWorkflowsHomeView(rows, view({ excludedProjects: ['s1:gone'] }));
	assert.equal(model.shown.length, 3);
});

test('1.2 show finished off hides done workflows', () => {
	const model = applyWorkflowsHomeView(rows, view({ showFinished: false }));
	assert.equal(model.shown.some((r) => r.tone === 'done'), false);
	assert.equal(model.statusCounts.done, 1);
});

test('1.2 the needs-you count ignores the filters', () => {
	assert.equal(needsYouCount(rows), 1);
});

test('1.3 sorts', () => {
	const keys = (sort) => applyWorkflowsHomeView(rows, view({ sort })).shown.map((r) => r.sessionId);
	assert.deepEqual(keys('attention'), ['session-a2', 'session-a1', 'session-b1']);
	assert.deepEqual(keys('recent'), ['session-a1', 'session-a2', 'session-b1']);
	assert.deepEqual(keys('progress'), ['session-b1', 'session-a1', 'session-a2']);
	// Same name: by terminal title, "b1" before "claude · pairing".
	assert.deepEqual(keys('name'), ['session-b1', 'session-a1', 'session-a2']);
});

test('1.3 a workflow with no step times sorts last by recency', () => {
	const fresh = buildWorkflowRows(
		[source('s', [['p', 'P', [terminal('n'), terminal('o')]]])],
		new Map([
			[
				's',
				server(
					attached('session-n', 'New', [step('1', 'not_started')]),
					attached('session-o', 'Old', [step('1', 'done', { startedAt: 1, endedAt: 2 })]),
				),
			],
		]),
	);
	assert.deepEqual(
		applyWorkflowsHomeView(fresh, view({ sort: 'recent' })).shown.map((r) => r.name),
		['Old', 'New'],
	);
});

test('1.3 grouping by project and by workflow, ordered by first member, with counts', () => {
	const byProject = applyWorkflowsHomeView(rows, view({ group: 'project', folded: ['s1:b'] }));
	assert.deepEqual(
		byProject.groups.map((g) => [g.key, g.title, g.rows.length, g.counts, g.folded]),
		[
			['s1:a', 'Alpha', 2, { alert: 1, running: 1, done: 0 }, false],
			['s1:b', 'Beta', 1, { alert: 0, running: 0, done: 1 }, true],
		],
	);
	const byWorkflow = applyWorkflowsHomeView(rows, view({ group: 'workflow' }));
	assert.deepEqual(
		byWorkflow.groups.map((g) => [g.title, g.rows.map((r) => r.sessionId)]),
		[
			['Release', ['session-a2']],
			['OpenSpec', ['session-a1', 'session-b1']],
		],
	);
	assert.equal(applyWorkflowsHomeView(rows, view()).groups, undefined);
});

function memoryStorage(initial) {
	const map = new Map(initial === undefined ? [] : [[WORKFLOWS_HOME_VIEW_KEY, initial]]);
	return {
		getItem: (key) => (map.has(key) ? map.get(key) : null),
		setItem: (key, value) => map.set(key, value),
		map,
	};
}

test('2.1 a view round-trips through storage', () => {
	const storage = memoryStorage();
	const chosen = view({ group: 'project', layout: 'rows', statuses: ['alert'], excludedProjects: ['s:p'], folded: ['s:p'], notes: 'current', narrow: true, showFinished: false, sort: 'name', text: 'x' });
	writeWorkflowsHomeView(chosen, storage);
	assert.deepEqual(readWorkflowsHomeView(storage), chosen);
});

test('2.1 corrupt and partial records fall back field by field', () => {
	assert.deepEqual(readWorkflowsHomeView(memoryStorage('{not json')), DEFAULT_WORKFLOWS_HOME_VIEW);
	assert.deepEqual(readWorkflowsHomeView(memoryStorage(undefined)), DEFAULT_WORKFLOWS_HOME_VIEW);
	const partial = parseWorkflowsHomeView({ group: 'rows', layout: 'rows', statuses: ['alert', 'bogus'], narrow: 'yes', folded: [1, 'k', 'k'] });
	assert.equal(partial.group, 'none');
	assert.equal(partial.layout, 'rows');
	assert.deepEqual(partial.statuses, ['alert']);
	assert.equal(partial.narrow, false);
	assert.deepEqual(partial.folded, ['k']);
	assert.deepEqual(parseWorkflowsHomeView([]), DEFAULT_WORKFLOWS_HOME_VIEW);
});

test('2.1 throwing storage yields the defaults and no error', () => {
	const throwing = {
		getItem() {
			throw new Error('denied');
		},
		setItem() {
			throw new Error('full');
		},
	};
	assert.deepEqual(readWorkflowsHomeView(throwing), DEFAULT_WORKFLOWS_HOME_VIEW);
	assert.doesNotThrow(() => writeWorkflowsHomeView(view({ narrow: true }), throwing));
	assert.deepEqual(readWorkflowsHomeView(undefined), DEFAULT_WORKFLOWS_HOME_VIEW);
});

test('2.1 reset is the default view', () => {
	assert.equal(isDefaultWorkflowsHomeView(DEFAULT_WORKFLOWS_HOME_VIEW), true);
	assert.equal(isDefaultWorkflowsHomeView(view({ group: 'project' })), false);
	assert.deepEqual(DEFAULT_WORKFLOWS_HOME_VIEW, {
		text: '',
		statuses: [],
		excludedProjects: [],
		group: 'none',
		layout: 'side',
		sort: 'attention',
		notes: 'full',
		showFinished: true,
		narrow: false,
		folded: [],
	});
});
