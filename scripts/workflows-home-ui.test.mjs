import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const testDirectory = await mkdtemp(join(process.cwd(), '.workflows-home-ui-test-'));
process.on('exit', () => rmSync(testDirectory, { recursive: true, force: true }));

async function bundle(entryPoint, outputName) {
	const outputPath = join(testDirectory, outputName);
	await build({
		entryPoints: [entryPoint],
		outfile: outputPath,
		bundle: true,
		format: 'cjs',
		platform: 'node',
		external: ['react', 'react-dom'],
		loader: { '.css': 'empty' },
		alias: {
			'@terminay/client-core': './packages/client-core/src/index.ts',
			'@terminay/protocol': './packages/protocol/src/index.ts',
		},
		logLevel: 'silent',
	});
	return require(outputPath);
}

const { WorkflowsHome } = await bundle('src/workspace/workflows/WorkflowsHome.tsx', 'home.cjs');
const model = await bundle('src/workspace/workflows/workflowsHomeModel.ts', 'model.cjs');
const viewModule = await bundle('src/workspace/workflows/workflowsHomeView.ts', 'view.cjs');
const { HomeView } = await bundle('src/workspace/HomeView.tsx', 'home-view.cjs');

const NOW = 10_000_000;
const MIN = 60_000;
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
const attached = (sessionId, name, steps, openingPrompt = '') => ({
	sessionId,
	state: 'attached',
	workflow: { id: `wf-${sessionId}`, name, openingPrompt, templateId: null, createdAt: 0, steps },
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
const rowsFor = (projects, views) =>
	model.buildWorkflowRows(
		[
			{
				serverId: 's',
				serverLabel: 's',
				projects: projects.map(([id, title]) => ({ id, title, color: '#123456', emoji: '' })),
				inventoryByProject: Object.fromEntries(projects.map(([id, , panels]) => [id, panels])),
			},
		],
		new Map([['s', { workflows: new Map(views.map((view) => [view.sessionId, view])) }]]),
	);

const running = attached(
	'session-a1',
	'OpenSpec: Propose → Ship',
	[
		step('1', 'done', { note: 'Proposed', startedAt: NOW - 20 * MIN, endedAt: NOW - 19 * MIN }),
		step('2', 'done', { note: 'Reviewed', startedAt: NOW - 19 * MIN, endedAt: NOW - 18 * MIN }),
		step('3', 'done', { note: 'Amended', startedAt: NOW - 18 * MIN, endedAt: NOW - 17 * MIN }),
		step('4', 'running', { note: 'Editing', startedAt: NOW - 14 * MIN }),
		step('5', 'not_started'),
		step('6', 'not_started'),
		step('7', 'not_started'),
	],
	'Build the thing',
);
const failing = attached('session-a2', 'Release beta', [
	step('1', 'failed', { note: 'notarytool: Invalid', startedAt: NOW - 5 * MIN, endedAt: NOW - 4 * MIN }),
	step('2', 'running', { note: 'Retrying', startedAt: NOW - MIN }),
	step('3', 'done', { note: 'Old note' }),
]);
const finished = attached('session-b1', 'OpenSpec: Propose → Ship', [
	step('1', 'done', { note: '<img src=x onerror=alert(1)>', startedAt: NOW - 60 * MIN, endedAt: NOW - 30 * MIN }),
]);
const rows = rowsFor(
	[
		['a', 'Alpha', [terminal('a1', 'claude · pairing'), terminal('a2', 'release')]],
		['b', 'Beta', [terminal('b1', 'deps')]],
	],
	[running, failing, finished],
);
const view = (overrides = {}) => ({ ...viewModule.DEFAULT_WORKFLOWS_HOME_VIEW, ...overrides });
const render = (props = {}) =>
	renderToStaticMarkup(
		React.createElement(WorkflowsHome, {
			rows,
			loading: false,
			onOpen: () => {},
			now: NOW,
			initialView: view(),
			...props,
		}),
	);
const count = (html, needle) => html.split(needle).length - 1;

test('3.1 every workflow is a column naming its project and terminal', () => {
	const html = render();
	assert.equal(count(html, 'data-workflows-home-column='), 3);
	assert.match(html, /3 of 3 workflows · 2 projects/);
	assert.match(html, /claude · pairing/);
	assert.match(html, /Alpha/);
	assert.match(html, /aria-label="Open terminal release"/);
});

test('3.1 a column shows progress, the brief, notes, and the running time', () => {
	const html = render({ initialView: view({ text: 'pairing' }) });
	assert.match(html, /3 of 7 done · 20m elapsed/);
	assert.match(html, /<summary>Brief<\/summary><p class="workflow-text">Build the thing<\/p>/);
	for (const note of ['Proposed', 'Reviewed', 'Amended', 'Editing']) assert.match(html, new RegExp(note));
	assert.match(html, /workflow-step workflow-step--active" data-status="running"/);
	assert.match(html, /<span class="workflow-step-time">14m<\/span>/);
});

test('3.1 a failed step and a running step are both highlighted, and the column needs you', () => {
	const html = render({ initialView: view({ text: 'release' }) });
	assert.equal(count(html, 'workflow-step--active'), 2);
	assert.match(html, /data-tone="alert"/);
	assert.match(html, /aria-label="Release beta, release, needs you"/);
});

test('3.1 Current only keeps the notes of failed, running and waiting steps only', () => {
	const html = render({ initialView: view({ text: 'release', notes: 'current' }) });
	assert.match(html, /notarytool: Invalid/);
	assert.match(html, /Retrying/);
	assert.doesNotMatch(html, /Old note/);
	assert.match(html, /workflows-home--notes-current/);
});

test('3.1 notes are text, never markup', () => {
	const html = render({ initialView: view({ text: 'deps' }) });
	assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
	assert.doesNotMatch(html, /<img/);
	assert.match(html, /1 of 1 done · finished/);
});

test('3.1 status chips count and expose their pressed state', () => {
	const html = render({ initialView: view({ statuses: ['alert'] }) });
	assert.match(html, /aria-pressed="true" data-workflows-home-status="alert">.*?Needs you<span class="workflows-home__chip-count">1</);
	assert.match(html, /aria-pressed="false" data-workflows-home-status="done">.*?Done<span class="workflows-home__chip-count">1</);
	assert.equal(count(html, 'data-workflows-home-column='), 1);
	assert.match(html, /Reset view/);
});

test('3.1 grouping by project in rows: one row per project, columns do not repeat the project', () => {
	const html = render({ initialView: view({ group: 'project', layout: 'rows' }) });
	assert.match(html, /data-workflows-home-layout="rows"/);
	assert.equal(count(html, 'data-workflows-home-group='), 2);
	assert.equal(count(html, 'workflows-home__row-scroller'), 2);
	assert.equal(count(html, 'class="workflows-home__project"'), 0);
	assert.match(html, /data-workflows-home-option="layout:rows"/);
	assert.match(html, /1 need you<\/span><span>1 running/);
});

test('3.1 grouping by workflow drops the repeated name from columns', () => {
	const html = render({ initialView: view({ group: 'workflow' }) });
	assert.match(html, /data-workflows-home-layout="side"/);
	assert.match(html, /data-workflows-home-group="OpenSpec: Propose → Ship"/);
	assert.equal(count(html, 'class="workflow-name"'), 0);
});

test('3.1 a folded group keeps its header and a dial per workflow, and says it is collapsed', () => {
	const html = render({ initialView: view({ group: 'project', folded: ['s:a'] }) });
	assert.match(html, /aria-expanded="false" aria-label="Unfold Alpha"/);
	assert.match(html, /aria-expanded="true" aria-label="Fold Beta"/);
	assert.equal(count(html, 'data-workflow-dial='), 2);
	assert.equal(count(html, 'data-workflows-home-column='), 1);
});

test('3.1 the layout option shows only while grouped', () => {
	assert.doesNotMatch(render(), /layout:side/);
	assert.match(render({ initialView: view({ group: 'project' }) }), /layout:side/);
});

test('3.1 loading, empty, and no-match states', () => {
	assert.match(render({ rows: [], loading: true }), /data-workflows-home-state="loading"/);
	const empty = render({ rows: [] });
	assert.match(empty, /data-workflows-home-state="empty"/);
	assert.match(empty, /Launch one from a terminal’s Command Bar/);
	const none = render({ initialView: view({ text: 'zzz' }) });
	assert.match(none, /data-workflows-home-state="no-match"/);
	assert.match(none, /0 of 3 workflows/);
});

test('3.1 an unrestorable workflow says so and needs you', () => {
	const broken = rowsFor([['p', 'Proj', [terminal('t', 'build')]]], [{ sessionId: 'session-t', state: 'unrestorable' }]);
	const html = render({ rows: broken });
	assert.match(html, /This terminal’s workflow could not be restored\./);
	assert.match(html, /aria-label="Workflow could not be restored, build, needs you"/);
});

test('3.2 fifty workflows render as fifty columns quickly', () => {
	const panels = Array.from({ length: 50 }, (_, index) => terminal(`t${index}`));
	const views = panels.map((panel) => attached(panel.sessionId, 'OpenSpec', running.workflow.steps));
	const many = rowsFor([['p', 'Proj', panels]], views);
	const started = performance.now();
	const html = render({ rows: many });
	const took = performance.now() - started;
	assert.equal(count(html, 'data-workflows-home-column='), 50);
	assert.ok(took < 1000, `rendered fifty columns in ${Math.round(took)}ms`);
});

test('4.1 the Home sidebar lists its sections and shows the workflows badge in its name', () => {
	const html = renderToStaticMarkup(
		React.createElement(
			HomeView,
			{
				currentSection: 'workflows',
				isActive: true,
				isSidebarVisible: true,
				onDismissSidebar: () => {},
				onOpenSection: () => {},
				onSidebarWidthCommit: () => {},
				sidebarWidth: 220,
				sectionBadges: { workflows: { count: 2, label: '2 workflows need you' } },
			},
			null,
		),
	);
	const order = [...html.matchAll(/data-terminay-home-section-tab="([a-zA-Z]+)"/g)].map((match) => match[1]);
	assert.deepEqual(order, ['home', 'tabs', 'bots', 'automations', 'workflows', 'recordings', 'pullRequests', 'issues']);
	assert.match(html, /aria-label="Workflows, 2 workflows need you"/);
	assert.match(html, /data-terminay-home-section-badge="workflows">2</);
});

test('4.1 no badge when nothing needs you', () => {
	const html = renderToStaticMarkup(
		React.createElement(
			HomeView,
			{
				currentSection: 'home',
				isActive: true,
				isSidebarVisible: true,
				onDismissSidebar: () => {},
				onOpenSection: () => {},
				onSidebarWidthCommit: () => {},
				sidebarWidth: 220,
				sectionBadges: { workflows: { count: 0, label: '0 workflows need you' } },
			},
			null,
		),
	);
	assert.doesNotMatch(html, /data-terminay-home-section-badge/);
});
