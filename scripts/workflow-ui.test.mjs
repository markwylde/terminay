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
const testDirectory = await mkdtemp(join(process.cwd(), '.workflow-ui-test-'));
// Removed however the run ends, even when a bundle fails before any test.
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
		// From source: the fast CI gate runs before any package is built.
		alias: {
			'@terminay/client-core': './packages/client-core/src/index.ts',
			'@terminay/protocol': './packages/protocol/src/index.ts',
		},
		logLevel: 'silent',
	});
	return require(outputPath);
}

const icons = await bundle('src/workspace/workflows/workflowIcons.tsx', 'icons.cjs');
const model = await bundle('src/workspace/workflows/workflowPanelModel.ts', 'model.cjs');
const setting = await bundle('src/workspace/workflows/workflowPanelSetting.ts', 'setting.cjs');
const panel = await bundle('src/workspace/workflows/WorkflowPanel.tsx', 'panel.cjs');
const badge = await bundle('src/workspace/workflows/WorkflowTabBadge.tsx', 'badge.cjs');
const drawer = await bundle('src/workspace/workflows/WorkflowDrawer.tsx', 'drawer.cjs');
const optionsMenu = await bundle('src/workspace/workflows/WorkflowOptionsMenu.tsx', 'menu.cjs');
const clientCore = await bundle('packages/client-core/src/workflows.ts', 'client-core.cjs');
// From source: the fast CI gate runs before any package is built.
const serverCore = await bundle('packages/server-core/src/workflowService/types.ts', 'server-types.cjs');
// Every bundle is built before the first test is declared: a test declared
// after a later top-level await never runs under --test-force-exit.
const seenStore = await bundle('src/workspace/workflows/workflowSeen.ts', 'seen.cjs');
// A second copy of the setting module, so its width is first read under the
// test's own storage.
const widthStore = await bundle('src/workspace/workflows/workflowPanelSetting.ts', 'setting-width.cjs');
// A third, so its note density is first read under the test's own storage.
const notesStore = await bundle('src/workspace/workflows/workflowPanelSetting.ts', 'setting-notes.cjs');
const homeView = await bundle('src/workspace/workflows/workflowsHomeView.ts', 'home-view.cjs');
const homeModel = await bundle('src/workspace/workflows/workflowsHomeModel.ts', 'home-model.cjs');
const library = await bundle('src/components/workflows/workflowLibraryModel.ts', 'library.cjs');
const category = await bundle('src/components/settings/WorkflowsCategory.tsx', 'category.cjs');
const settingsClient = await bundle('src/components/workflows/useWorkflowSettingsClient.ts', 'settings-client.cjs');
const groups = await bundle('src/shared/macroLibraryGroups.ts', 'groups.cjs');
const commandBar = await bundle('src/workspace/CommandBar.tsx', 'command-bar.cjs');
const commands = await bundle('src/workspace/workflows/commandBarWorkflows.tsx', 'command-workflows.cjs');


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
const attached = (steps, extra = {}) => ({
	sessionId: 'session-a',
	state: 'attached',
	workflow: {
		id: 'wf-1',
		name: 'Standard flow',
		openingPrompt: '',
		templateId: null,
		createdAt: 0,
		steps: steps.map((item, index) => ({ after: index === 0 ? [] : [steps[index - 1].id], ...item })),
	},
	resumeStepId: null,
	unfinished: true,
	...extra,
});
const target = { serverId: 'server-a', projectId: 'project-a', sessionId: 'session-a' };
const render = (props) =>
	renderToStaticMarkup(
		React.createElement(panel.WorkflowPanel, { target, focusTerminal: () => {}, mode: 'collapsed', ...props }),
	);

// 5.1

test('every icon the server accepts has a client icon, and the client and server agree on the set', () => {
	assert.deepEqual([...clientCore.WORKFLOW_ICON_NAMES], [...serverCore.WORKFLOW_ICON_NAMES]);
	assert.deepEqual(Object.keys(icons.WORKFLOW_ICON_PATHS).sort(), [...serverCore.WORKFLOW_ICON_NAMES].sort());
	for (const path of Object.values(icons.WORKFLOW_ICON_PATHS)) assert.match(path, /^M/);
});

// 5.2

test('the rail shows each status in its colour, fill, and glyph, in step order, with title and status names', () => {
	const markup = render({
		view: attached([
			step('a', 'done'),
			step('b', 'running'),
			step('c', 'failed'),
			step('d', 'needs_input'),
			step('e', 'not_started'),
		]),
	});
	const markers = [...markup.matchAll(/class="workflow-marker ([^"]+)" data-status="([^"]+)" role="img" aria-label="([^"]+)"/g)].map(
		([, classes, status, label]) => [status, classes, label],
	);
	assert.deepEqual(markers, [
		['done', 'workflow-marker--done workflow-marker--filled', 'Step a: done'],
		['running', 'workflow-marker--running', 'Step b: running'],
		['failed', 'workflow-marker--alert workflow-marker--filled', 'Step c: failed'],
		['needs_input', 'workflow-marker--alert workflow-marker--filled', 'Step d: needs you'],
		['not_started', 'workflow-marker--idle', 'Step e: not started'],
	]);
	assert.equal(model.markerStyle('done').glyph, 'check');
	assert.equal(model.markerStyle('running').glyph, 'dot');
	assert.equal(model.markerStyle('failed').glyph, 'cross');
	assert.equal(model.markerStyle('needs_input').glyph, 'exclamation');
	assert.equal(model.markerStyle('not_started').glyph, 'none');
});

test('the rail shows the workflow name at its foot, as text', () => {
	const markup = render({ view: attached([step('a', 'done')]) });
	assert.match(markup, /<\/ol><span class="workflow-rail-name" title="Standard flow">Standard flow<\/span>/);
	const unrestorable = render({ view: { sessionId: 'session-a', state: 'unrestorable' } });
	assert.ok(!unrestorable.includes('workflow-rail-name'));
});

test('a step with an icon shows it, and a done step without one shows a check', () => {
	const withIcon = render({ view: attached([step('a', 'done', { icon: 'wrench' })]) });
	assert.ok(withIcon.includes(icons.WORKFLOW_ICON_PATHS.wrench));
	const without = render({ view: attached([step('a', 'done')]) });
	assert.ok(without.includes('M3.5 8.5 6.5 11.5 12.5 4.5'));
});

test('the expanded panel shows name, progress, brief, times and notes, and highlights the active step', () => {
	const full = render({
		mode: 'expanded',
		view: {
			...attached([
				step('a', 'done', { startedAt: 0, endedAt: 65_000, note: 'proposal written' }),
				step('b', 'needs_input', { startedAt: 65_000, note: 'Keep workflows per terminal?' }),
				step('c', 'not_started'),
			]),
			workflow: {
				...attached([
					step('a', 'done', { startedAt: 0, endedAt: 65_000, note: 'proposal written' }),
					step('b', 'needs_input', { startedAt: 65_000, note: 'Keep workflows per terminal?' }),
					step('c', 'not_started'),
				]).workflow,
				openingPrompt: 'Ship it.',
			},
		},
	});
	assert.match(full, /1 of 3 done/);
	assert.match(full, /<details class="workflow-brief"><summary>Brief<\/summary><p class="workflow-text">Ship it\.<\/p><\/details>/);
	assert.match(full, /<span class="workflow-step-title">Step a<span class="workflow-visually-hidden">, done<\/span><\/span>/);
	assert.match(full, /<span class="workflow-step-time">1m<\/span>/);
	assert.match(full, /proposal written/);
	assert.match(full, /class="workflow-step workflow-step--active" data-status="needs_input" data-workflow-step-id="b" aria-current="step"/);
	assert.match(full, /Keep workflows per terminal\?/);
});

test('workflow text is rendered literally, never as markup', () => {
	const hostile = '<img src=x onerror=alert(1)>';
	const markup = render({
		mode: 'expanded',
		view: {
			...attached([]),
			workflow: { id: 'wf-1', name: hostile, openingPrompt: hostile, templateId: null, createdAt: 0, steps: [step('a', 'done', { title: hostile, note: hostile, after: [] })] },
		},
	});
	assert.ok(!markup.includes('<img'));
	assert.equal(markup.split('&lt;img src=x onerror=alert(1)&gt;').length - 1, 4);
});

// 5.3

test('the collapse setting is one device-local choice every panel follows', () => {
	const seen = [];
	const stop = setting.subscribeWorkflowPanelSetting(() => seen.push(setting.workflowPanelSetting()));
	setting.setWorkflowPanelSetting('expanded');
	setting.setWorkflowPanelSetting('expanded');
	setting.setWorkflowPanelSetting('collapsed');
	stop();
	assert.deepEqual(seen, ['expanded', 'collapsed']);
	// Nothing in the setting module reaches a server: it takes no client at all.
	assert.deepEqual(Object.keys(setting).sort(), [
		'WORKFLOW_DRAWER_STORAGE_KEY',
		'WORKFLOW_LAYOUT_STORAGE_KEY',
		'WORKFLOW_PANEL_NOTES_STORAGE_KEY',
		'WORKFLOW_PANEL_STORAGE_KEY',
		'WORKFLOW_PANEL_WIDTH_STORAGE_KEY',
		'setWorkflowDrawerSetting',
		'setWorkflowLayout',
		'setWorkflowPanelNotes',
		'setWorkflowPanelSetting',
		'setWorkflowPanelWidth',
		'subscribeWorkflowDrawerSetting',
		'subscribeWorkflowLayout',
		'subscribeWorkflowPanelNotes',
		'subscribeWorkflowPanelSetting',
		'subscribeWorkflowPanelWidth',
		'useWorkflowDrawerSetting',
		'useWorkflowLayout',
		'useWorkflowPanelNotes',
		'useWorkflowPanelSetting',
		'useWorkflowPanelWidth',
		'workflowDrawerSetting',
		'workflowLayout',
		'workflowPanelNotes',
		'workflowPanelSetting',
		'workflowPanelWidth',
	]);
});

// workflow-panel-note-density 1.1

test('the note density is device-local, separate from Home, and an unusable stored value reads as Full', () => {
	const stored = new Map();
	const listeners = new Set();
	globalThis.localStorage = {
		getItem: (k) => (stored.has(k) ? stored.get(k) : null),
		setItem: (k, v) => stored.set(k, String(v)),
	};
	globalThis.addEventListener = (type, fn) => type === 'storage' && listeners.add(fn);
	globalThis.removeEventListener = (_type, fn) => listeners.delete(fn);
	const key = notesStore.WORKFLOW_PANEL_NOTES_STORAGE_KEY;
	const otherWindowWrites = (value) => {
		stored.set(key, value);
		for (const fn of listeners) fn({ key });
	};
	try {
		assert.equal(key, 'terminay.workflowPanelNotes.v1');
		assert.notEqual(key, homeView.WORKFLOWS_HOME_VIEW_KEY, 'Home keeps its own choice');
		assert.equal(notesStore.workflowPanelNotes(), 'full', 'the default on an empty store');
		const heard = [];
		const stop = notesStore.subscribeWorkflowPanelNotes(() => heard.push(notesStore.workflowPanelNotes()));
		notesStore.setWorkflowPanelNotes('short');
		notesStore.setWorkflowPanelNotes('short');
		notesStore.setWorkflowPanelNotes('current');
		notesStore.setWorkflowPanelNotes('full');
		assert.deepEqual(heard, ['short', 'current', 'full'], 'one notice per change');
		assert.equal(stored.get(key), 'full');
		assert.ok(![...stored.keys()].includes(homeView.WORKFLOWS_HOME_VIEW_KEY), 'Home’s view is never written');
		// Another window's write is followed.
		otherWindowWrites('current');
		assert.equal(notesStore.workflowPanelNotes(), 'current');
		for (const unusable of ['FULL', 'none', '', '2 lines', '{}']) {
			otherWindowWrites(unusable);
			assert.equal(notesStore.workflowPanelNotes(), 'full', `stored ${JSON.stringify(unusable)}`);
		}
		// A storage event for another key changes nothing.
		otherWindowWrites('short');
		const before = heard.length;
		for (const fn of listeners) fn({ key: homeView.WORKFLOWS_HOME_VIEW_KEY });
		assert.equal(heard.length, before);
		stop();
		// Storage that throws keeps the choice for this window.
		globalThis.localStorage = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
		};
		notesStore.setWorkflowPanelNotes('current');
		assert.equal(notesStore.workflowPanelNotes(), 'current');
	} finally {
		delete globalThis.localStorage;
		delete globalThis.addEventListener;
		delete globalThis.removeEventListener;
	}
});

// workflow-panel-note-density 1.2

test('a step’s note shows at each density by its status, and Home uses the same current-step rule', () => {
	const statuses = ['not_started', 'running', 'done', 'failed', 'needs_input', 'skipped'];
	const current = new Set(['running', 'failed', 'needs_input']);
	for (const status of statuses) {
		assert.equal(model.isCurrentStep(status), current.has(status), status);
		assert.equal(homeModel.isHighlighted(status), current.has(status), `Home ${status}`);
		const withNote = { status, note: 'a note' };
		assert.equal(model.showsStepNote(withNote, 'full'), true, `full ${status}`);
		assert.equal(model.showsStepNote(withNote, 'short'), true, `short ${status}`);
		assert.equal(model.showsStepNote(withNote, 'current'), current.has(status), `current ${status}`);
		for (const notes of model.WORKFLOW_PANEL_NOTES)
			assert.equal(model.showsStepNote({ status, note: '' }, notes), false, 'an empty note is never shown');
	}
	assert.deepEqual(model.WORKFLOW_PANEL_NOTES, ['full', 'short', 'current']);
});

// workflow-panel-note-density 2.1, 2.2

test('the expanded header offers Full, 2 lines and Current only, and the panel shows notes at that density', () => {
	const steps = [
		step('a', 'done', { note: 'note a' }),
		step('b', 'failed', { note: 'note b' }),
		step('c', 'skipped', { note: 'note c' }),
		step('d', 'running', { note: 'note d' }),
		step('e', 'not_started'),
	];
	const at = (notes) => render({ mode: 'expanded', view: attached(steps), ...(notes ? { notes } : {}) });
	const full = at();
	assert.match(full, /class="workflow-panel workflow-panel--expanded workflow-panel--notes-full"/);
	// The density is chosen in the ⋯ menu, not the header (ADR-0128).
	assert.ok(!/<select/.test(full));
	for (const note of ['note a', 'note b', 'note c', 'note d']) assert.match(full, new RegExp(note));
	assert.ok(!/workflow-step-note[^>]*title=/.test(full), 'no title while notes show in full');

	const short = at('short');
	assert.match(short, /workflow-panel--notes-short/);
	assert.match(short, /<span class="workflow-step-note workflow-text" title="note a">note a<\/span>/);

	const currentOnly = at('current');
	assert.deepEqual(currentOnly.match(/note [a-e]/g), ['note b', 'note d']);
	assert.equal(currentOnly.match(/class="workflow-step[ "]/g).length, 5, 'every step is still listed');

	// The choice is presentation: back at Full every note is whole again.
	assert.equal(at('full'), full);

	// Status changes move the shown note with them.
	const later = render({
		mode: 'expanded',
		notes: 'current',
		view: attached([
			step('a', 'done', { note: 'note a' }),
			step('d', 'done', { note: 'note d' }),
			step('e', 'needs_input', { note: 'note e' }),
		]),
	});
	assert.deepEqual(later.match(/note [a-e]/g), ['note e']);

	// No current step: no notes, every step listed.
	const settled = render({
		mode: 'expanded',
		notes: 'current',
		view: attached([step('a', 'done', { note: 'note a' }), step('b', 'skipped', { note: 'note b' })]),
	});
	assert.equal(settled.match(/note [a-e]/g), null);
	assert.equal(settled.match(/class="workflow-step[ "]/g).length, 2);

	// The rail shows no notes and no density control.
	const rail = render({ mode: 'collapsed', notes: 'full', view: attached(steps) });
	assert.ok(!/note [a-e]/.test(rail));
	assert.ok(!/workflow-notes-select/.test(rail));
});

test('a workflow that could not be restored says so and offers its options menu, which holds removal', () => {
	const client = { remove: async () => {} };
	const markup = render({ mode: 'expanded', view: { sessionId: 'session-a', state: 'unrestorable' }, client });
	assert.match(markup, /could not be restored/);
	assert.match(markup, /aria-label="Workflow options"[^>]*aria-haspopup="menu"/);
	// No control outside the menu removes a workflow.
	assert.doesNotMatch(markup, /Remove/);
	const rail = render({ view: { sessionId: 'session-a', state: 'unrestorable' }, client });
	assert.match(rail, /aria-label="Workflow could not be restored"/);
});

// 5.4

test('below 60 columns beside the expanded panel the panel stays a rail, and the setting is unchanged', () => {
	const cell = 8;
	const mode = (setting, columns, c) => model.panelLayout(setting, model.WORKFLOW_PANEL_WIDTH, columns, c).mode;
	// The minimum width beside 60 columns decides narrowness.
	const lost = Math.ceil((model.WORKFLOW_PANEL_MIN_WIDTH - model.WORKFLOW_RAIL_WIDTH) / cell);
	assert.equal(mode('expanded', 60 + lost, cell), 'expanded');
	assert.equal(mode('expanded', 59 + lost, cell), 'forced-collapsed');
	assert.equal(mode('collapsed', 200, cell), 'collapsed');
	// Narrowness is the pane's whatever the setting, so expanding opens the overlay.
	assert.equal(mode('collapsed', 59 + lost, cell), 'forced-collapsed');
	assert.equal(mode('collapsed', undefined, undefined), 'collapsed');
	// Forced collapsed reserves only the rail, so the overlay never resizes the terminal.
	const forced = model.panelLayout('expanded', 264, 59 + lost, cell);
	assert.equal(model.reservedWidth(forced), model.WORKFLOW_RAIL_WIDTH);
	assert.equal(model.reservedWidth(model.panelLayout('expanded', 264, undefined, undefined)), 264);
	assert.equal(model.reservedWidth(model.panelLayout('collapsed', 480, undefined, undefined)), model.WORKFLOW_RAIL_WIDTH);
	assert.equal(model.reservedWidth(undefined), 0);
	const markup = render({ mode: 'forced-collapsed', view: attached([step('a', 'running')]) });
	assert.match(markup, /data-workflow-mode="forced-collapsed"/);
	assert.match(markup, /workflow-panel--collapsed/);
	assert.ok(!markup.includes('role="dialog"'));
});

// resizable-workflow-panel 1.1

test('the panel is drawn at the chosen width, narrowed to keep 60 columns, and collapsed only below its minimum', () => {
	const cell = 8;
	// Without geometry the chosen width is drawn, up to the maximum.
	assert.deepEqual(model.panelLayout('expanded', 480, undefined, undefined), { mode: 'expanded', width: 480, maxWidth: 640 });
	assert.equal(model.panelLayout('expanded', 9000, undefined, undefined).width, 640);
	assert.equal(model.panelLayout('expanded', 10, undefined, undefined).width, 200);
	// Plenty of room: the chosen width.
	assert.equal(model.panelLayout('expanded', 480, 200, cell).width, 480);
	// 60 columns plus room for a 300px panel: narrowed, setting kept.
	const columns = 60 + (300 - model.WORKFLOW_RAIL_WIDTH) / cell;
	const narrowed = model.panelLayout('expanded', 480, columns, cell);
	assert.equal(narrowed.mode, 'expanded');
	assert.equal(narrowed.width, 300);
	assert.equal(narrowed.maxWidth, 300);
	// The pane grows back: the chosen width again.
	assert.equal(model.panelLayout('expanded', 480, columns + 40, cell).width, 480);
	// Exactly the minimum still fits; one column less does not.
	const atMin = 60 + (200 - model.WORKFLOW_RAIL_WIDTH) / cell;
	assert.equal(model.panelLayout('expanded', 480, atMin, cell).width, 200);
	assert.equal(model.panelLayout('expanded', 480, atMin - 1, cell).mode, 'forced-collapsed');
	// The overlay: the chosen width, or 85% of the pane.
	assert.equal(model.overlayWidth(480, 400), 340);
	assert.equal(model.overlayWidth(264, 2000), 264);
	assert.equal(model.overlayWidth(480, undefined), 480);
});

// resizable-workflow-panel 1.2

test('the chosen width is device-local, clamped when set, and an unusable stored width reads as the default', () => {
	const stored = new Map();
	const listeners = new Set();
	globalThis.localStorage = {
		getItem: (k) => (stored.has(k) ? stored.get(k) : null),
		setItem: (k, v) => stored.set(k, String(v)),
	};
	globalThis.addEventListener = (type, fn) => type === 'storage' && listeners.add(fn);
	globalThis.removeEventListener = (_type, fn) => listeners.delete(fn);
	const key = widthStore.WORKFLOW_PANEL_WIDTH_STORAGE_KEY;
	const otherWindowWrites = (value) => {
		stored.set(key, value);
		for (const fn of listeners) fn({ key });
	};
	try {
		assert.equal(widthStore.workflowPanelWidth(), 264, 'the default on an empty store');
		const heard = [];
		const stop = widthStore.subscribeWorkflowPanelWidth(() => heard.push(widthStore.workflowPanelWidth()));
		widthStore.setWorkflowPanelWidth(400.4);
		widthStore.setWorkflowPanelWidth(400);
		assert.equal(stored.get(key), '400');
		widthStore.setWorkflowPanelWidth(9000);
		widthStore.setWorkflowPanelWidth(-5);
		assert.deepEqual(heard, [400, 640, 200], 'one notice per change, clamped');
		// Another window's write is followed.
		otherWindowWrites('512');
		assert.equal(widthStore.workflowPanelWidth(), 512);
		for (const unusable of ['900', '199', 'wide', '', '3.5e2', '-300']) {
			otherWindowWrites(unusable);
			assert.equal(widthStore.workflowPanelWidth(), 264, `stored ${JSON.stringify(unusable)}`);
		}
		stop();
		// Storage that throws keeps the width for this window.
		globalThis.localStorage = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
		};
		widthStore.setWorkflowPanelWidth(333);
		assert.equal(widthStore.workflowPanelWidth(), 333);
	} finally {
		delete globalThis.localStorage;
		delete globalThis.addEventListener;
		delete globalThis.removeEventListener;
	}
});

// resizable-workflow-panel 2.2

test('only the expanded panel has a resize separator, keyboard-reachable and bounded by its pane', () => {
	const view = attached([step('a', 'running')]);
	const expanded = render({ mode: 'expanded', view, width: 300, maxWidth: 420 });
	const separator = expanded.match(/<hr [^>]*class="workflow-panel-separator"[^>]*\/?>/)?.[0];
	assert.ok(separator, 'the expanded panel has a separator');
	assert.match(separator, /aria-label="Resize workflow panel"/);
	assert.match(separator, /aria-orientation="vertical"/);
	assert.match(separator, /tabindex="0"/i);
	assert.match(separator, /aria-valuemin="200"/);
	assert.match(separator, /aria-valuemax="420"/);
	assert.match(separator, /aria-valuenow="300"/);
	assert.match(expanded, /--workflow-panel-width:300px/);
	assert.ok(!render({ view }).includes('workflow-panel-separator'), 'the rail has none');
	assert.ok(!render({ mode: 'forced-collapsed', view }).includes('workflow-panel-separator'), 'a narrow pane has none');
});

// 5.5

const MIN = 60_000;

test('the dial is amber and filled to done over total while a step runs, with no count as text', () => {
	const steps = [
		step('a', 'done'), step('b', 'done'), step('c', 'done'),
		{ ...step('d', 'running', { startedAt: 0 }), title: 'Implement' },
		step('e', 'not_started'), step('f', 'not_started'), step('g', 'not_started'), step('h', 'not_started'),
	];
	const summary = model.tabSummary(attached(steps), 14 * MIN);
	assert.equal(summary.tone, 'running');
	assert.equal(summary.fraction, 3 / 8);
	assert.equal(summary.label, 'Implement · 3 of 8 · 14m');
	assert.equal(summary.completionKey, undefined);
	assert.equal(summary.ticking, true);
	const markup = renderToStaticMarkup(React.createElement(badge.WorkflowDial, { summary }));
	assert.match(markup, /workflow-dial--running/);
	assert.match(markup, /aria-label="Implement · 3 of 8 · 14m"/);
	assert.match(markup, /title="Implement · 3 of 8 · 14m"/);
	assert.ok(!markup.includes('3/8'), 'no count drawn as text');
});

test('needing the user or a failed step makes the dial red, and the name says so', () => {
	const needs = model.tabSummary(
		attached([step('a', 'done'), step('b', 'done'), { ...step('c', 'needs_input', { startedAt: 0 }), title: 'Review' }, step('d', 'not_started'), step('e', 'not_started')]),
		3 * MIN,
	);
	assert.equal(needs.tone, 'alert');
	assert.equal(needs.label, 'Review needs you · 2 of 5 · 3m');
	const mixed = model.tabSummary(
		attached([{ ...step('a', 'failed'), title: 'Build' }, { ...step('b', 'running', { startedAt: 0 }), title: 'Implement' }]),
		MIN,
	);
	assert.equal(mixed.tone, 'alert');
	assert.equal(mixed.label, 'Implement · 0 of 2 · 1m · Build failed');
	const failedOnly = model.tabSummary(attached([step('a', 'done'), { ...step('b', 'failed'), title: 'Build' }, step('c', 'not_started')]));
	assert.equal(failedOnly.tone, 'alert');
	assert.equal(failedOnly.label, 'Build failed · 1 of 3');
});

test('between steps the dial is grey and names the next step; finished is full green', () => {
	const idle = model.tabSummary(attached([step('a', 'done'), { ...step('b', 'not_started'), title: 'Verify' }]));
	assert.equal(idle.tone, 'idle');
	assert.equal(idle.fraction, 0.5);
	assert.equal(idle.label, 'Next: Verify · 1 of 2');
	assert.equal(idle.ticking, false);
	const finished = model.tabSummary(attached([step('a', 'done', { endedAt: 10 }), step('b', 'done', { endedAt: 25 })]));
	assert.equal(finished.tone, 'done');
	assert.equal(finished.fraction, 1);
	assert.equal(finished.label, 'All 2 steps done');
	assert.equal(finished.completionKey, 'wf-1:25');
});

test('the time is since the step started, across needing the user', () => {
	const back = model.tabSummary(attached([step('a', 'running', { startedAt: 0 })]), 20 * MIN);
	assert.equal(back.label, 'Step a · 0 of 1 · 20m');
});

test('an unrestorable workflow is a full red ring named as such; no workflow, no dial', () => {
	const summary = model.tabSummary({ sessionId: 'session-a', state: 'unrestorable' });
	assert.deepEqual([summary.tone, summary.fraction, summary.label], ['alert', 1, 'Workflow could not be restored']);
	assert.match(renderToStaticMarkup(React.createElement(badge.WorkflowDial, { summary })), /workflow-dial__arc/);
	assert.equal(model.tabSummary(undefined), undefined);
	const empty = renderToStaticMarkup(React.createElement(badge.WorkflowDial, { summary: { ...summary, tone: 'idle', fraction: 0 } }));
	assert.ok(!empty.includes('workflow-dial__arc'), 'an empty dial draws only its track');
});

test('a reopened workflow that finishes again is a new completion', () => {
	const first = model.completionKey({ id: 'wf-1', steps: [step('a', 'done', { endedAt: 10 })] });
	const again = model.completionKey({ id: 'wf-1', steps: [step('a', 'done', { endedAt: 99 })] });
	assert.notEqual(first, again);
	assert.equal(model.completionKey({ id: 'wf-1', steps: [step('a', 'running')] }), undefined);
	assert.equal(model.completionKey({ id: 'wf-1', steps: [] }), undefined);
});

test('a completion is seen once its terminal was active and stops being, or goes away', () => {
	const committed = [];
	const tracker = new seenStore.WorkflowSeenTracker((key) => committed.push(key));
	tracker.update(undefined, true);
	tracker.update('wf-1:25', true);
	assert.deepEqual(committed, [], 'not seen while still active');
	tracker.update('wf-1:25', false);
	assert.deepEqual(committed, ['wf-1:25']);
	tracker.update('wf-1:25', false);
	assert.deepEqual(committed, ['wf-1:25'], 'committed once');

	const changed = [];
	const t2 = new seenStore.WorkflowSeenTracker((key) => changed.push(key));
	t2.update('wf-1:25', true);
	t2.update(undefined, true); // reopened while active
	t2.update(undefined, false);
	assert.deepEqual(changed, [], 'a completion that changed first is not seen');
	t2.update('wf-1:99', false); // finished again in the background
	assert.deepEqual(changed, []);

	const gone = [];
	const t3 = new seenStore.WorkflowSeenTracker((key) => gone.push(key));
	t3.update('wf-2:5', true);
	t3.end();
	assert.deepEqual(gone, ['wf-2:5'], 'going away while showing it counts as seen');
});

test('seen completions are kept on the device, shared across windows, and capped', () => {
	const stored = new Map();
	const listeners = new Set();
	globalThis.localStorage = {
		getItem: (k) => (stored.has(k) ? stored.get(k) : null),
		setItem: (k, v) => stored.set(k, String(v)),
	};
	globalThis.addEventListener = (type, fn) => type === 'storage' && listeners.add(fn);
	globalThis.removeEventListener = (type, fn) => listeners.delete(fn);
	try {
		seenStore.resetWorkflowSeenForTests();
		assert.equal(seenStore.isWorkflowCompletionSeen('wf-1:1'), false);
		seenStore.markWorkflowCompletionSeen('wf-1:1');
		assert.equal(seenStore.isWorkflowCompletionSeen('wf-1:1'), true);
		assert.deepEqual(JSON.parse(stored.get(seenStore.WORKFLOW_SEEN_STORAGE_KEY)), ['wf-1:1']);

		// Another window writes; this one hears the storage event.
		let heard = 0;
		const unsubscribe = seenStore.subscribeWorkflowSeen(() => heard++);
		stored.set(seenStore.WORKFLOW_SEEN_STORAGE_KEY, JSON.stringify(['wf-9:9', 'wf-1:1']));
		for (const fn of listeners) fn({ key: seenStore.WORKFLOW_SEEN_STORAGE_KEY });
		assert.equal(heard, 1);
		assert.equal(seenStore.isWorkflowCompletionSeen('wf-9:9'), true);
		// A write here keeps the other window's entry.
		seenStore.markWorkflowCompletionSeen('wf-2:2');
		assert.deepEqual(JSON.parse(stored.get(seenStore.WORKFLOW_SEEN_STORAGE_KEY)), ['wf-2:2', 'wf-9:9', 'wf-1:1']);
		unsubscribe();

		for (let i = 0; i < seenStore.WORKFLOW_SEEN_LIMIT + 5; i++) seenStore.markWorkflowCompletionSeen(`wf-x:${i}`);
		const list = JSON.parse(stored.get(seenStore.WORKFLOW_SEEN_STORAGE_KEY));
		assert.equal(list.length, seenStore.WORKFLOW_SEEN_LIMIT);
		assert.equal(list[0], `wf-x:${seenStore.WORKFLOW_SEEN_LIMIT + 4}`);
		assert.equal(seenStore.isWorkflowCompletionSeen('wf-1:1'), false, 'the oldest are evicted');

		// Storage that throws still records the completion in this window.
		globalThis.localStorage = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
		};
		seenStore.resetWorkflowSeenForTests();
		seenStore.markWorkflowCompletionSeen('wf-3:3');
		assert.equal(seenStore.isWorkflowCompletionSeen('wf-3:3'), true);
	} finally {
		delete globalThis.localStorage;
		delete globalThis.addEventListener;
		delete globalThis.removeEventListener;
		seenStore.resetWorkflowSeenForTests();
	}
});

// 6.1 / 6.2: Settings › Workflows


const templateState = (templates, categories = []) => ({ revision: 3, cursor: 'c3', categories, templates });
const savedTemplate = (id, extra = {}) => ({
	id,
	name: `Flow ${id}`,
	description: '',
	category: '',
	openingPrompt: '',
	steps: [{ id: `${id}-s1`, title: 'Explore', prompt: 'look around', icon: '', after: [] }],
	...extra,
});

test('the library groups by category, shows step counts, and the filter reaches step prompts', () => {
	const draft = library.draftFrom(
		templateState(
			[
				savedTemplate('a', { category: 'OpenSpec', steps: [{ id: 's1', title: 'Propose', prompt: 'write the proposal', icon: '', after: [] }, { id: 's2', title: 'Apply', prompt: 'zebracorn', icon: '', after: ['s1'] }] }),
				savedTemplate('b', { category: 'Release' }),
				savedTemplate('c'),
			],
			['OpenSpec', 'Release'],
		),
	);
	const unsavedIds = new Set(['c']);
	const items = category.workflowListItems({ draft, unsavedIds });
	assert.deepEqual(items.map((item) => item.title), ['Flow a · 2 steps', 'Flow b · 1 step', 'Flow c · 1 step']);
	assert.deepEqual(items.map((item) => item.isUnsaved), [false, false, true]);
	const all = groups.groupMacroLibrary(items, draft.categories, '');
	assert.deepEqual(all.map((group) => [group.category, group.macros.map((macro) => macro.id)]), [['OpenSpec', ['a']], ['Release', ['b']], ['', ['c']]]);
	const filtered = groups.groupMacroLibrary(items, draft.categories, 'zebracorn');
	assert.deepEqual(filtered.map((group) => [group.category, group.macros.map((macro) => macro.id)]), [['OpenSpec', ['a']]]);
	for (const field of ['description', 'openingPrompt']) {
		const one = library.draftFrom(templateState([savedTemplate('x', { [field]: 'quokka' })]));
		assert.equal(groups.groupMacroLibrary(category.workflowListItems({ draft: one, unsavedIds: new Set() }), [], 'quokka').length, 1);
	}
});

test('a saved step keeps its id on save, and a new step is sent without one', () => {
	const draft = library.draftFrom(templateState([savedTemplate('a')]));
	const template = { ...draft.templates[0], steps: [...draft.templates[0].steps, library.emptyStep(2)] };
	const input = library.templateInput(template);
	assert.equal(input.steps[0].id, 'a-s1');
	assert.equal('id' in input.steps[1], false);
	assert.equal(library.templateFingerprint(draft.templates[0]), library.templateFingerprint(library.draftFrom(templateState([savedTemplate('a')])).templates[0]));
});

test('the outline editor draws a bracket, its actions, and a handle per step', () => {
	const template = library.withSteps(
		{ id: 't', name: 'T', description: '', category: '', openingPrompt: '' },
		[
			{ key: 'p', title: 'Propose', prompt: '', icon: '', after: [] },
			{ key: 'c', title: 'Codex review', prompt: '', icon: '', after: ['p'] },
			{ key: 's', title: 'Spec review', prompt: '', icon: '', after: ['p'] },
			{ key: 'a', title: 'Amend', prompt: '', icon: '', after: ['c', 's'] },
		],
	);
	const noop = () => {};
	const markup = renderToStaticMarkup(
		React.createElement(category.StepOutline, {
			editor: { addStep: noop, addStepThen: noop, addStepAlongside: noop, addStepTrack: noop, removeStep: noop, updateStep: noop, moveStep: noop, moveStepBefore: noop },
			template,
		}),
	);
	assert.match(markup, /aria-label="Move step 1" aria-keyshortcuts="Alt\+ArrowUp Alt\+ArrowDown"/);
	assert.equal(markup.match(/class="workflow-outline-group"/g).length, 1);
	assert.equal(markup.match(/class="workflow-outline-track"/g).length, 2);
	assert.equal(markup.match(/>\+ then</g).length, 4);
	assert.equal(markup.match(/>\+ alongside</g).length, 4);
	assert.match(markup, />\+ another track alongside</);
	assert.match(markup, />\+ Add step at the end</);
	assert.doesNotMatch(markup, /workflow-outline-after|workflow-outline-notice/);
});

test('the icon picker offers none and every icon, and shows the chosen one', () => {
	const markup = renderToStaticMarkup(React.createElement(category.IconPicker, { index: 0, value: 'wrench', onChange() {} }));
	assert.ok(markup.includes(icons.WORKFLOW_ICON_PATHS.wrench));
	assert.match(markup, /<option value="">No icon<\/option>/);
	assert.match(markup, /<option value="wrench" selected="">wrench<\/option>/);
	assert.equal([...markup.matchAll(/<option /g)].length, clientCore.WORKFLOW_ICON_NAMES.length + 1);
	const none = renderToStaticMarkup(React.createElement(category.IconPicker, { index: 0, value: '', onChange() {} }));
	assert.match(none, /data-icon="none"/);
	assert.ok(!none.includes('<svg'));
});

test('a save is refused with a message for an empty template and for an oversized one', () => {
	const empty = { ...library.emptyTemplate(1, ''), name: ' ', steps: [] };
	assert.deepEqual(library.templateProblems(empty), ['A workflow needs a name.', '“A workflow” has no steps.']);
	const untitled = { ...library.emptyTemplate(1, ''), steps: [{ ...library.emptyStep(1), title: '' }] };
	assert.deepEqual(library.templateProblems(untitled), ['“Workflow 1”: step 1 needs a title.']);
	const big = 'x'.repeat(8 * 1024);
	const oversized = {
		...library.emptyTemplate(1, ''),
		name: 'Huge',
		openingPrompt: big,
		steps: Array.from({ length: 7 }, (_, index) => ({ ...library.emptyStep(index + 1), prompt: big })),
	};
	const problems = library.templateProblems(oversized);
	assert.equal(problems.length, 1);
	assert.match(problems[0], /^“Huge” is \d+\.\d KiB; a workflow may be at most 56 KiB\.$/);
	assert.deepEqual(library.templateProblems(library.emptyTemplate(2, '')), []);
});

test('the editor shows the size against 56 KiB and the exact launch text', () => {
	const template = { ...library.emptyTemplate(1, ''), openingPrompt: 'Ship <b>it</b>.' };
	const markup = renderToStaticMarkup(
		React.createElement(category.WorkflowsCategory, {
			editor: {
				draft: { templates: [template], categories: [] },
				loadError: null, isReady: true, isSaving: false, isDirty: false, errorText: null, saveState: 'All changes saved',
				unsavedIds: new Set(), filter: '', setFilter() {}, selected: template, selectedId: template.id, select() {},
				focusNameFor: { current: null }, updateTemplate() {}, addTemplate() {}, duplicateSelected() {}, deleteSelected() {},
				addStep() {}, removeStep() {}, updateStep() {}, moveStep() {}, reorderSteps() {}, createCategory: () => '', renameCategory: () => true,
				removeCategory() {}, assignNewCategory() {}, moveTemplate() {}, reorderTemplates() {}, reorderCategories() {}, save: async () => true, discard() {},
			},
			render: ({ detail }) => detail,
		}),
	);
	assert.match(markup, new RegExp(`${library.formatKiB(library.serializedSize(template)).replace('.', '\\.')} of 56 KiB`));
	const preview = library.launchPreview(template.openingPrompt);
	assert.ok(preview.startsWith('/goal Ship <b>it</b>.'));
	// The preview is the one line the server types (workflow-service.test.mjs
	// checks the server's launch text is this same typedWorkflowGoal).
	assert.ok(!/[\r\n\t]/.test(preview));
	assert.equal(preview, library.launchPreview(`${template.openingPrompt}\n\n`));
	assert.ok(markup.includes(preview.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;')));
	assert.ok(!/collapse|(?<!aria-)expanded/i.test(markup), 'no template field chooses how the panel opens');
	assert.match(markup, /<fieldset class="workflow-editor-fieldset">/);
});

test('while a save is in flight the editor takes no edits', () => {
	const template = library.emptyTemplate(1, '');
	const markup = renderToStaticMarkup(
		React.createElement(category.WorkflowsCategory, {
			editor: {
				draft: { templates: [template], categories: [] }, isReady: true, isSaving: true, isDirty: true, saveState: 'Saving…',
				unsavedIds: new Set(), filter: '', setFilter() {}, selected: template, selectedId: template.id, select() {}, focusNameFor: { current: null },
			},
			render: ({ detail }) => detail,
		}),
	);
	assert.match(markup, /<fieldset class="workflow-editor-fieldset" disabled="">/);
});

test('an incompatible or missing connection shows its state instead of templates', () => {
	const old = { snapshot: { negotiated: { capabilities: ['macros.v1'] } } };
	assert.equal(settingsClient.workflowsStateOf(old), 'incompatible');
	assert.equal(settingsClient.workflowsStateOf({ snapshot: {} }), 'disconnected');
	assert.equal(settingsClient.workflowsStateOf(undefined), 'disconnected');
	assert.equal(settingsClient.workflowsStateOf({ snapshot: { negotiated: { capabilities: ['workflows.v1'] } } }), undefined);
	const markup = renderToStaticMarkup(
		React.createElement(category.WorkflowsCategory, {
			editor: { draft: { templates: [], categories: [] }, isReady: false, isDirty: false, filter: '', selected: null, selectedId: null, focusNameFor: { current: null }, addTemplate() {} },
			unavailable: 'incompatible',
			render: ({ list, detail }) => React.createElement(React.Fragment, null, list, detail),
		}),
	);
	assert.match(markup, /does not support workflows/);
	assert.ok(!markup.includes('macro-nav'));
});

test('with server A selected, a save of a same-id template is sent only to server A', async () => {
	const server = (name) => {
		const calls = [];
		return {
			calls,
			snapshot: { negotiated: { capabilities: ['workflows.v1'] } },
			onStateChange: () => () => {},
			query: async (operation) => {
				calls.push(['query', operation]);
				return { result: templateState([savedTemplate('same')]) };
			},
			command: async (operation, payload, options) => {
				calls.push(['command', operation, options?.expectedRevision]);
				return { result: { ...templateState(payload.templates.map((t) => ({ ...savedTemplate(t.id), ...t, steps: t.steps.map((s, i) => ({ id: s.id ?? `${name}-${i}`, ...s })) }))), revision: 4 } };
			},
		};
	};
	const a = server('a');
	const b = server('b');
	let selected;
	const Probe = ({ applicationClient }) => {
		selected = settingsClient.useWorkflowSettingsClient(applicationClient);
		return null;
	};
	renderToStaticMarkup(React.createElement(Probe, { applicationClient: a }));
	assert.equal(selected.unavailable, undefined);
	const state = await selected.client.templates();
	const draft = library.draftFrom(state);
	const edited = { ...draft.templates[0], name: 'Renamed on A' };
	const saved = await selected.client.replaceTemplates([library.templateInput(edited)], draft.categories, { expectedRevision: state.revision });
	assert.equal(saved.templates[0].name, 'Renamed on A');
	assert.deepEqual(a.calls, [['query', 'workflows.templates.get'], ['command', 'workflows.templates.replace', 3]]);
	assert.deepEqual(b.calls, []);
});

test('a stale save explains itself, and a refusal is read through the facade wrapper', () => {
	const wrapped = { message: 'workflow template revision is stale', cause: { code: 'conflict', details: { reason: 'workflow_exists', workflowId: 'wf-2' } } };
	assert.match(library.describeSaveError(Object.assign(new Error(wrapped.message), wrapped)), /changed on the server/);
	assert.deepEqual(clientCore.existingWorkflowOf(wrapped), { workflowId: 'wf-2' });
	assert.equal(clientCore.existingWorkflowOf(new Error('other')), undefined);
});

// 7.1 / 7.2: Command Bar


const templateFor = (id, name, category = '') => ({
	id, name, description: '', category, openingPrompt: '', revision: 1,
	steps: [{ id: `${id}-1`, title: 'Investigate', prompt: '', icon: '', after: [] }],
});
const commandTemplates = templateState(
	[templateFor('loose', 'Loose ends'), { ...templateFor('std', 'Standard flow', 'OpenSpec'), description: 'Not the lite one' }, templateFor('hot', 'Hotfix', 'Release'), templateFor('lite', 'Lite flow', 'OpenSpec')],
	['OpenSpec', 'Release', 'Empty'],
);
const unfinishedView = (name = 'Standard flow', id = 'wf-1') => ({
	...attached([step('a', 'done'), step('b', 'running')]),
	workflow: { id, name, openingPrompt: '', templateId: 'std', createdAt: 0, steps: [step('a', 'done'), step('b', 'running')] },
	unfinished: true,
});
const grouped = (items, query = '') =>
	commandBar.groupCommandBarItems(commandBar.filterCommandBarItems(items, query)).map((group) => [group.group, group.items.map(({ item }) => item.title)]);
const macroEntry = { id: 'm', group: 'Macros', groupKey: 'Macros', groupOrder: 0, title: 'Say hi', description: '', searchText: 'say hi', icon: null, onSelect() {} };
const placeEntry = { id: 'p', group: 'Projects', title: 'Terminay', description: '', searchText: 'terminay', icon: null, onSelect() {} };

test('templates are grouped by category in category order, then Workflows, after macros and before places', () => {
	const items = commands.workflowCommandItems({ templates: commandTemplates, view: undefined, onLaunch() {}, onResume() {} });
	assert.deepEqual(grouped([placeEntry, ...items, macroEntry]), [
		['Macros', ['Say hi']],
		['OpenSpec', ['Standard flow', 'Lite flow']],
		['Release', ['Hotfix']],
		['Workflows', ['Loose ends']],
		['Projects', ['Terminay']],
	]);
	// A search keeps saved order, even over a better match, and drops a category with no match.
	assert.deepEqual(grouped(items, 'lite'), [['OpenSpec', ['Standard flow', 'Lite flow']]]);
	assert.equal(grouped(items, 'workflow').length, 3);
	assert.deepEqual(grouped(items, 'hotf'), [['Release', ['Hotfix']]]);
});

test('Resume is listed above every template only while the workflow is unfinished', () => {
	const resumed = [];
	const items = commands.workflowCommandItems({ templates: commandTemplates, view: unfinishedView(), onLaunch() {}, onResume: () => resumed.push(true) });
	const groups = grouped(items);
	assert.deepEqual(groups[0], ['Workflow', ['Resume workflow']]);
	assert.equal(items[0].description, 'Standard flow');
	items[0].onSelect();
	assert.deepEqual(resumed, [true]);
	const finished = { ...unfinishedView(), unfinished: false };
	assert.ok(!commands.workflowCommandItems({ templates: commandTemplates, view: finished, onLaunch() {}, onResume() {} }).some((item) => item.title === 'Resume workflow'));
	assert.ok(!commands.workflowCommandItems({ templates: commandTemplates, view: { sessionId: 'session-a', state: 'unrestorable' }, onLaunch() {}, onResume() {} }).some((item) => item.title === 'Resume workflow'));
});

const fakeServer = (serverId, templates, workflows = new Map()) => {
	const calls = [];
	return {
		calls,
		entry: {
			serverId,
			templates,
			workflows,
			client: {
				launch: async (...args) => { calls.push(['launch', ...args]); },
				resume: async (...args) => { calls.push(['resume', ...args]); },
				list: async () => [...workflows.values()],
			},
		},
	};
};
const probeCommands = (props) => {
	let result;
	const Probe = () => {
		result = commands.useWorkflowCommands({ projectId: 'project-b', isOpen: true, close() {}, focusTerminal() {}, onError() {}, ...props });
		return null;
	};
	renderToStaticMarkup(React.createElement(Probe));
	return result;
};

test('only the active terminal’s server’s templates are listed, and a launch goes only to it', async () => {
	const a = fakeServer('server-a', templateState([templateFor('a1', 'Only on A')]));
	const b = fakeServer('server-b', templateState([templateFor('b1', 'Only on B')]));
	const servers = new Map([['server-a', a.entry], ['server-b', b.entry]]);
	const { items } = probeCommands({ servers, serverId: 'server-b', getActiveSessionId: () => 'session-b' });
	assert.deepEqual(items.map((item) => item.title), ['Only on B']);
	items[0].onSelect();
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(b.calls, [['launch', 'b1', { serverId: 'server-b', projectId: 'project-b', sessionId: 'session-b' }, undefined]]);
	assert.deepEqual(a.calls, []);
});

test('no workflow entries without an active terminal, or before the Command Bar opens', () => {
	const b = fakeServer('server-b', commandTemplates);
	const servers = new Map([['server-b', b.entry]]);
	assert.deepEqual(probeCommands({ servers, serverId: 'server-b', getActiveSessionId: () => null }).items, []);
	assert.deepEqual(probeCommands({ servers, serverId: 'server-b', isOpen: false, getActiveSessionId: () => 'session-b' }).items, []);
	assert.deepEqual(probeCommands({ servers, serverId: undefined, getActiveSessionId: () => 'session-b' }).items, []);
});

const launchTarget = { serverId: 'server-b', projectId: 'project-b', sessionId: 'session-a' };

test('cancelling the replace confirmation sends nothing', async () => {
	const server = fakeServer('server-b', commandTemplates);
	const asked = [];
	const outcome = await commands.launchWorkflow(
		{ client: server.entry.client, target: launchTarget, current: unfinishedView('W1'), confirm: async (name) => { asked.push(name); return false; } },
		'std',
	);
	assert.equal(outcome, 'cancelled');
	assert.deepEqual(asked, ['W1']);
	assert.deepEqual(server.calls, []);
});

test('a confirmed replace names the workflow it replaces, and a stale one asks again about the new one', async () => {
	const calls = [];
	let attached = unfinishedView('W1', 'wf-1');
	const client = {
		launch: async (templateId, target, replaceWorkflowId) => {
			calls.push(replaceWorkflowId);
			if (replaceWorkflowId !== attached.workflow.id) {
				const error = new Error('terminal already has an unfinished workflow');
				throw Object.assign(new Error(error.message), { cause: { code: 'conflict', details: { reason: 'workflow_exists', workflowId: attached.workflow.id } } });
			}
		},
		list: async () => [attached],
	};
	const asked = [];
	// An agent replaces W1 with W2 while the user is confirming.
	const outcome = await commands.launchWorkflow(
		{
			client,
			target: launchTarget,
			current: attached,
			confirm: async (name) => {
				asked.push(name);
				if (name === 'W1') attached = unfinishedView('W2', 'wf-2');
				return true;
			},
		},
		'std',
	);
	assert.equal(outcome, 'launched');
	assert.deepEqual(asked, ['W1', 'W2']);
	assert.deepEqual(calls, ['wf-1', 'wf-2']);
});

test('a launch on a terminal without an unfinished workflow asks nothing', async () => {
	const server = fakeServer('server-b', commandTemplates);
	const outcome = await commands.launchWorkflow(
		{ client: server.entry.client, target: launchTarget, current: { ...unfinishedView(), unfinished: false }, confirm: async () => assert.fail('asked') },
		'std',
	);
	assert.equal(outcome, 'launched');
	assert.deepEqual(server.calls, [['launch', 'std', launchTarget, undefined]]);
});

test('the replace dialog names the workflow and offers Cancel first', () => {
	const markup = renderToStaticMarkup(React.createElement(commands.WorkflowReplaceDialog, { name: '<W1>', onSettle() {} }));
	assert.match(markup, /role="alertdialog"/);
	assert.match(markup, /Replace “&lt;W1&gt;”\?/);
	assert.ok(markup.indexOf('>Cancel<') < markup.indexOf('>Replace<'));
});

// skip-workflow-steps

test('the client and server agree on the step statuses, including skipped', () => {
	assert.deepEqual([...clientCore.WORKFLOW_STEP_STATUSES], [...serverCore.WORKFLOW_STEP_STATUSES]);
	assert.ok(clientCore.WORKFLOW_STEP_STATUSES.includes('skipped'));
});

test('a skipped step is a dashed, dimmed grey marker with a dash, named skipped, distinct from done and not started', () => {
	const style = model.markerStyle('skipped');
	assert.deepEqual(style, { tone: 'skipped', filled: false, glyph: 'dash' });
	assert.notDeepEqual(style, model.markerStyle('not_started'));
	assert.notDeepEqual(style, model.markerStyle('done'));
	const markup = render({ view: attached([step('a', 'done'), step('b', 'skipped', { icon: 'camera' })]) });
	assert.match(markup, /class="workflow-marker workflow-marker--skipped" data-status="skipped" role="img" aria-label="Step b: skipped"/);
	assert.ok(markup.includes(icons.WORKFLOW_ICON_PATHS.camera), 'a skipped step keeps its icon');
	const plain = render({ view: attached([step('a', 'skipped')]) });
	assert.ok(plain.includes('M4.5 8h7'), 'a skipped step without an icon shows a dash');
});

test('the expanded panel strikes a skipped step, shows its note and no duration, and counts it as done', () => {
	const markup = render({
		mode: 'expanded',
		view: attached([
			step('a', 'done', { startedAt: 0, endedAt: 65_000 }),
			step('b', 'skipped', { startedAt: 65_000, endedAt: 65_000, note: 'not a visual change' }),
			step('c', 'not_started'),
		]),
	});
	assert.match(markup, /2 of 3 done/);
	assert.match(markup, /class="workflow-step workflow-step--skipped" data-status="skipped"/);
	assert.match(markup, /not a visual change/);
	const skippedRow = markup.slice(markup.indexOf('data-status="skipped"'), markup.indexOf('data-status="not_started"'));
	assert.ok(!skippedRow.includes('workflow-step-time'), 'no duration on a skipped step');
});

test('done and skipped steps finish a workflow, and the dial and label say so', () => {
	const finished = model.tabSummary(attached([step('a', 'done', { endedAt: 10 }), step('b', 'skipped', { endedAt: 25 })]));
	assert.equal(finished.tone, 'done');
	assert.equal(finished.fraction, 1);
	assert.equal(finished.label, 'All 2 steps done or skipped');
	assert.equal(finished.completionKey, 'wf-1:25');
	const allSkipped = model.tabSummary(attached([step('a', 'skipped', { endedAt: 5 })]));
	assert.equal(allSkipped.label, 'All 1 step done or skipped');
	assert.equal(model.isFinished({ steps: [step('a', 'skipped'), step('b', 'failed')] }), false);
	const next = model.tabSummary(attached([step('a', 'skipped'), { ...step('b', 'not_started'), title: 'Verify' }]));
	assert.equal(next.label, 'Next: Verify · 1 of 2');
	assert.equal(next.fraction, 0.5);
	assert.equal(badge.workflowStepLine(attached([step('a', 'done'), step('b', 'skipped')])), 'All 2 steps done or skipped');
	// Restoring a step reopens the workflow.
	assert.equal(model.completionKey({ id: 'wf-1', steps: [step('a', 'done', { endedAt: 1 }), step('b', 'not_started')] }), undefined);
	// Elapsed stops at the last end once finished.
	assert.equal(model.elapsed({ steps: [step('a', 'done', { startedAt: 0, endedAt: 60_000 }), step('b', 'skipped', { startedAt: 120_000, endedAt: 120_000 })] }, 10 * MIN), '2m');
});

test('Skip is offered on not started and failed steps, Restore on skipped ones, and nothing else', () => {
	assert.deepEqual(
		['not_started', 'running', 'done', 'failed', 'needs_input', 'skipped'].map((status) => [status, model.canSkip(status), model.canRestore(status)]),
		[
			['not_started', true, false],
			['running', false, false],
			['done', false, false],
			['failed', true, false],
			['needs_input', false, false],
			['skipped', false, true],
		],
	);
	const client = { updateStep: async () => {}, remove: async () => {} };
	const markup = render({
		mode: 'expanded',
		client,
		view: attached([
			step('a', 'done'),
			step('b', 'running', { startedAt: 0 }),
			step('c', 'failed'),
			step('d', 'needs_input'),
			step('e', 'skipped'),
			step('f', 'not_started'),
		]),
	});
	const actions = [...markup.matchAll(/aria-label="(Skip|Restore) (Step [a-f])"/g)].map(([, action, title]) => `${action} ${title}`);
	assert.deepEqual(actions, ['Skip Step c', 'Restore Step e', 'Skip Step f']);
	assert.equal(model.PANEL_SKIP_NOTE, 'Skipped from the panel');
});

test('the client sends a step update with its note and expected status to update-step', async () => {
	const sent = [];
	const real = new clientCore.WorkflowClient({ command: async (operation, payload) => sent.push([operation, payload]) });
	await real.updateStep(target, 'step-1', 'skipped', { note: 'Skipped from the panel', expectedStatus: 'failed' });
	await real.updateStep(target, 'step-1', 'not_started', { expectedStatus: 'skipped' });
	assert.deepEqual(sent, [
		['workflow.update-step', { target, stepId: 'step-1', status: 'skipped', note: 'Skipped from the panel', expectedStatus: 'failed' }],
		['workflow.update-step', { target, stepId: 'step-1', status: 'not_started', expectedStatus: 'skipped' }],
	]);
});

// dag-workflows (ADR-0128): layouts, the options menu, brackets, capsules, the drawer.

const renderDrawer = (props) =>
	renderToStaticMarkup(
		React.createElement(drawer.WorkflowDrawer, {
			target,
			focusTerminal: () => {},
			mode: 'collapsed',
			height: 164,
			overlayHeight: 164,
			...props,
		}),
	);
const dag = (steps) => ({
	sessionId: 'session-a',
	state: 'attached',
	workflow: { id: 'wf-1', name: 'Standard flow', openingPrompt: '', templateId: null, createdAt: 0, steps },
	resumeStepId: null,
	unfinished: true,
});
const reviews = (statuses = {}) =>
	dag([
		step('propose', statuses.propose ?? 'done', { title: 'Propose', after: [] }),
		step('codex', statuses.codex ?? 'running', { title: 'Codex review', after: ['propose'] }),
		step('specs', statuses.specs ?? 'running', { title: 'Spec review', after: ['propose'] }),
		step('amend', statuses.amend ?? 'not_started', { title: 'Amend', after: ['codex', 'specs'] }),
	]);

test('the layout and the drawer collapse are device-local, with vertical and collapsed as fallbacks', () => {
	const stored = new Map([
		[setting.WORKFLOW_LAYOUT_STORAGE_KEY, 'diagonal'],
		[setting.WORKFLOW_DRAWER_STORAGE_KEY, 'open'],
	]);
	globalThis.localStorage = {
		getItem: (key) => stored.get(key) ?? null,
		setItem: (key, value) => stored.set(key, value),
	};
	try {
		assert.equal(setting.workflowLayout(), 'vertical');
		assert.equal(setting.workflowDrawerSetting(), 'collapsed');
		const seen = [];
		const stopLayout = setting.subscribeWorkflowLayout(() => seen.push(setting.workflowLayout()));
		setting.setWorkflowLayout('horizontal');
		setting.setWorkflowLayout('horizontal');
		assert.equal(stored.get(setting.WORKFLOW_LAYOUT_STORAGE_KEY), 'horizontal');
		// Each layout keeps its own collapse: the drawer's choice leaves the panel's alone.
		const panelBefore = setting.workflowPanelSetting();
		setting.setWorkflowDrawerSetting('expanded');
		assert.equal(setting.workflowPanelSetting(), panelBefore);
		assert.equal(stored.get(setting.WORKFLOW_DRAWER_STORAGE_KEY), 'expanded');
		// Another window's choice reaches this one through the storage event.
		const listeners = [];
		const realAdd = globalThis.addEventListener;
		globalThis.addEventListener = (type, listener) => type === 'storage' && listeners.push(listener);
		const stopStorage = setting.subscribeWorkflowLayout(() => seen.push(`storage:${setting.workflowLayout()}`));
		stored.set(setting.WORKFLOW_LAYOUT_STORAGE_KEY, 'vertical');
		for (const listener of listeners) listener({ key: setting.WORKFLOW_LAYOUT_STORAGE_KEY });
		stopStorage();
		globalThis.addEventListener = realAdd;
		stopLayout();
		assert.deepEqual(seen, ['horizontal', 'storage:vertical']);
	} finally {
		setting.setWorkflowLayout('vertical');
		setting.setWorkflowDrawerSetting('collapsed');
		delete globalThis.localStorage;
	}
});

test('the drawer is header plus map, at most 240px, and keeps the strip unless the terminal keeps ten rows', () => {
	assert.equal(model.drawerHeight(1), 36 + 16 + 56);
	assert.equal(model.drawerHeight(2), 36 + 16 + 112);
	assert.equal(model.drawerHeight(9), 240);
	// 600px pane, 17px rows: 164px drawer leaves 436px, over 170.
	assert.deepEqual(model.drawerLayout('expanded', 2, 600, 17), { mode: 'expanded', height: 164, overlayHeight: 164 });
	assert.equal(model.reservedHeight(model.drawerLayout('expanded', 2, 600, 17)), 164);
	// 300px pane: 164px leaves 136px, under ten 17px rows; the overlay is at most 85% of the pane.
	const short = model.drawerLayout('expanded', 4, 300, 17);
	assert.deepEqual(short, { mode: 'forced-collapsed', height: 240, overlayHeight: 240 });
	assert.equal(model.drawerLayout('expanded', 4, 200, 17).overlayHeight, 170);
	assert.equal(model.reservedHeight(short), 46);
	assert.equal(model.reservedHeight(model.drawerLayout('collapsed', 2, 600, 17)), 46);
	assert.equal(model.reservedHeight(undefined), 0);
	// The rail's reservation is its computed width.
	assert.equal(model.reservedWidth({ mode: 'collapsed', width: 264, maxWidth: 640 }, 44), 44);
});

test('the progress line counts running and needs-you steps, and the strip names every active step in order', () => {
	const steps = [
		step('a', 'done', { title: 'Plan' }),
		step('b', 'running', { title: 'Server' }),
		step('c', 'running', { title: 'Panel UI' }),
		step('d', 'needs_input', { title: 'Docs' }),
	];
	assert.equal(model.progressLabel({ steps }, 0), '1 of 4 done · 2 running · 1 needs you');
	assert.deepEqual(model.stripWords(steps), [
		{ title: 'Server', needsYou: false },
		{ title: 'Panel UI', needsYou: false },
		{ title: 'Docs', needsYou: true },
	]);
	assert.equal(model.stripWords([step('a', 'done'), step('b', 'skipped')]), 'Finished');
	assert.equal(model.stripWords([step('a', 'done'), step('b', 'not_started')]), 'Waiting');
});

test('two reviews of one proposal show as a bracket of two tracks with no after text, and both are highlighted', () => {
	const markup = render({ mode: 'expanded', view: reviews() });
	assert.equal(markup.match(/class="workflow-group /g).length, 1);
	assert.match(markup, /class="workflow-group workflow-group--running"/);
	assert.equal(markup.match(/class="workflow-track"/g).length, 2);
	assert.doesNotMatch(markup, /workflow-step-after/);
	assert.equal(markup.match(/workflow-step--active/g).length, 2);
	assert.match(markup, /1 of 4 done<\/span><span aria-hidden="true"> · <\/span><span class="workflow-progress-part">2 running/);
	// Propose, the bracket, then Amend, in that order.
	assert.ok(markup.indexOf('Propose') < markup.indexOf('workflow-group') && markup.indexOf('workflow-group') < markup.indexOf('Amend'));
});

test('a dependency the brackets cannot show reads "after" under its step only', () => {
	const markup = render({
		mode: 'expanded',
		view: dag([
			step('amend', 'done', { title: 'Amend', after: [] }),
			step('server', 'running', { title: 'Server', after: ['amend'] }),
			step('ui', 'running', { title: 'UI', after: ['amend'] }),
			step('docs', 'needs_input', { title: 'Docs', after: ['amend'] }),
			step('verify', 'not_started', { title: 'Verify', after: ['server', 'ui'] }),
			step('e2e', 'not_started', { title: 'E2E', after: ['ui'] }),
			step('pr', 'not_started', { title: 'PR', after: ['verify', 'e2e', 'docs'] }),
		]),
	});
	assert.equal(markup.match(/workflow-step-after/g).length, 1);
	assert.match(markup, /<span class="workflow-step-after">after UI<\/span>/);
	// The outer bracket holds a needs-you step: red. Its sequence track is divided from the other.
	assert.match(markup, /class="workflow-group workflow-group--alert workflow-group--divided"/);
});

test('the collapsed rail draws a capsule per bracket at the computed width', () => {
	const flat = render({ view: attached([step('a', 'done'), step('b', 'running'), step('c', 'not_started')]) });
	assert.match(flat, /--workflow-rail-width:36px/);
	assert.doesNotMatch(flat, /workflow-capsule/);
	const nested = dag([
		step('a', 'done', { after: [] }),
		step('b', 'running', { after: ['a'] }),
		step('c', 'running', { after: ['a'] }),
		step('d', 'not_started', { after: ['a'] }),
		step('e', 'not_started', { after: ['b', 'c'] }),
		step('f', 'not_started', { after: ['c'] }),
		step('g', 'not_started', { after: ['e', 'f', 'd'] }),
	]);
	const rail = render({ view: nested });
	assert.match(rail, /--workflow-rail-width:44px/);
	assert.equal(panel.workflowRailWidth(nested), 44);
	assert.equal(rail.match(/class="workflow-capsule /g).length, 3);
	assert.match(rail, /workflow-capsule-rule/);
	assert.equal(rail.match(/class="workflow-rail-step[ "]/g).length, 7);
	// The rail offers its options menu too.
	assert.match(rail, /aria-label="Workflow options"/);
});

test('the options menu offers Show as Vertical and Horizontal, the current one checked, then Remove workflow…', () => {
	// Static markup renders the closed control; open the menu through its click handler.
	const markup = renderToStaticMarkup(
		React.createElement(optionsMenu.WorkflowOptionsMenu, { view: reviews(), target, client: { remove: async () => {} } }),
	);
	assert.match(markup, /aria-haspopup="menu" aria-expanded="false"/);
	assert.doesNotMatch(markup, /role="menu"/);
});

test('the strip shows the count, the small map and every active step; the expanded drawer shows the metro map', () => {
	const strip = renderDrawer({ view: reviews({ specs: 'needs_input' }) });
	assert.match(strip, /data-workflow-layout="horizontal"/);
	assert.match(strip, /--workflow-drawer-height:46px/);
	assert.match(strip, /<span class="workflow-strip-count">1\/4<\/span>/);
	assert.equal(strip.match(/class="workflow-strip-dot /g).length, 4);
	assert.match(strip, /<b class="">Codex review<\/b>|<b>Codex review<\/b>/);
	assert.match(strip, /<b class="workflow-strip-word--alert">Spec review<\/b> needs you/);
	assert.match(strip, /aria-label="Workflow options"/);
	assert.match(strip, /aria-label="Expand workflow"/);

	const expanded = renderDrawer({ mode: 'expanded', view: reviews() });
	assert.match(expanded, /--workflow-drawer-height:164px/);
	assert.match(expanded, /1 of 4 done<\/span><span aria-hidden="true"> · <\/span><span class="workflow-progress-part">2 running/);
	// Propose in column 0, the reviews stacked in column 1, Amend in column 2.
	const at = (id) => {
		const match = expanded.match(new RegExp(`data-workflow-step-id="${id}"[^>]*style="left:(\\d+)px;top:(\\d+)px"`));
		return [Number(match[1]), Number(match[2])];
	};
	assert.deepEqual(at('propose'), [50, 8]);
	assert.deepEqual(at('codex'), [170, 8]);
	assert.deepEqual(at('specs'), [170, 64]);
	assert.deepEqual(at('amend'), [290, 8]);
	// Lines leaving Propose are solid green; those into Amend wait.
	assert.match(expanded, /class="workflow-edge workflow-edge--done" data-workflow-edge="propose&gt;codex"/);
	assert.match(expanded, /class="workflow-edge workflow-edge--waiting" data-workflow-edge="codex&gt;amend"/);
	// One station is in the tab order; the rest are reached with the arrow keys.
	assert.equal(expanded.match(/class="workflow-station[^"]*"[^>]*tabindex="0"/g).length, 1);
	assert.match(expanded, /aria-label="Collapse workflow"/);
});
