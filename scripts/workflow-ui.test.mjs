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
const clientCore = await bundle('packages/client-core/src/workflows.ts', 'client-core.cjs');
// From source: the fast CI gate runs before any package is built.
const serverCore = await bundle('packages/server-core/src/workflowService/types.ts', 'server-types.cjs');


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
	workflow: { id: 'wf-1', name: 'Standard flow', openingPrompt: '', templateId: null, createdAt: 0, steps },
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
				id: 'wf-1',
				name: 'Standard flow',
				openingPrompt: 'Ship it.',
				templateId: null,
				createdAt: 0,
				steps: [
					step('a', 'done', { startedAt: 0, endedAt: 65_000, note: 'proposal written' }),
					step('b', 'needs_input', { startedAt: 65_000, note: 'Keep workflows per terminal?' }),
					step('c', 'not_started'),
				],
			},
		},
	});
	assert.match(full, /1 of 3 done/);
	assert.match(full, /<details class="workflow-brief"><summary>Brief<\/summary><p class="workflow-text">Ship it\.<\/p><\/details>/);
	assert.match(full, /done · 1m/);
	assert.match(full, /proposal written/);
	assert.match(full, /class="workflow-step workflow-step--active" data-status="needs_input" aria-current="step"/);
	assert.match(full, /Keep workflows per terminal\?/);
});

test('workflow text is rendered literally, never as markup', () => {
	const hostile = '<img src=x onerror=alert(1)>';
	const markup = render({
		mode: 'expanded',
		view: {
			...attached([]),
			workflow: { id: 'wf-1', name: hostile, openingPrompt: hostile, templateId: null, createdAt: 0, steps: [step('a', 'done', { title: hostile, note: hostile })] },
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
		'WORKFLOW_PANEL_STORAGE_KEY',
		'setWorkflowPanelSetting',
		'subscribeWorkflowPanelSetting',
		'useWorkflowPanelSetting',
		'workflowPanelSetting',
	]);
});

test('a workflow that could not be restored says so and offers removal', () => {
	const client = { remove: async () => {} };
	const markup = render({ mode: 'expanded', view: { sessionId: 'session-a', state: 'unrestorable' }, client });
	assert.match(markup, /could not be restored/);
	assert.match(markup, /Remove…/);
	const rail = render({ view: { sessionId: 'session-a', state: 'unrestorable' }, client });
	assert.match(rail, /aria-label="Workflow could not be restored"/);
});

// 5.4

test('below 60 columns beside the expanded panel the panel stays a rail, and the setting is unchanged', () => {
	const cell = 8;
	const lost = Math.ceil((model.WORKFLOW_PANEL_WIDTH - model.WORKFLOW_RAIL_WIDTH) / cell);
	assert.equal(model.panelMode('expanded', 60 + lost, cell), 'expanded');
	assert.equal(model.panelMode('expanded', 59 + lost, cell), 'forced-collapsed');
	assert.equal(model.panelMode('collapsed', 200, cell), 'collapsed');
	// Narrowness is the pane's whatever the setting, so expanding opens the overlay.
	assert.equal(model.panelMode('collapsed', 59 + lost, cell), 'forced-collapsed');
	assert.equal(model.panelMode('collapsed', undefined, undefined), 'collapsed');
	// Forced collapsed reserves only the rail, so the overlay never resizes the terminal.
	assert.equal(model.reservedWidth('forced-collapsed'), model.WORKFLOW_RAIL_WIDTH);
	assert.equal(model.reservedWidth('expanded'), model.WORKFLOW_PANEL_WIDTH);
	assert.equal(model.reservedWidth(undefined), 0);
	const markup = render({ mode: 'forced-collapsed', view: attached([step('a', 'running')]) });
	assert.match(markup, /data-workflow-mode="forced-collapsed"/);
	assert.match(markup, /workflow-panel--collapsed/);
	assert.ok(!markup.includes('role="dialog"'));
});

// 5.5

test('the tab shows done over total and a red marker while a step failed or needs input', () => {
	const summary = model.tabSummary(attached([step('a', 'done'), step('b', 'needs_input'), step('c', 'not_started')]));
	assert.deepEqual([summary.done, summary.total, summary.alert], [1, 3, true]);
	const markup = renderToStaticMarkup(React.createElement(badge.WorkflowTabProgress, { summary }));
	assert.match(markup, />1\/3</);
	assert.match(markup, /terminal-tab-workflow-alert/);
	const calm = model.tabSummary(attached([step('a', 'done'), step('b', 'running')]));
	assert.equal(calm.alert, false);
	assert.ok(!renderToStaticMarkup(React.createElement(badge.WorkflowTabProgress, { summary: calm })).includes('alert"'));
	assert.equal(renderToStaticMarkup(React.createElement(badge.WorkflowTabProgress, { summary: undefined })), '');
});

// 6.1 / 6.2: Settings › Workflows

const library = await bundle('src/components/workflows/workflowLibraryModel.ts', 'library.cjs');
const category = await bundle('src/components/settings/WorkflowsCategory.tsx', 'category.cjs');
const settingsClient = await bundle('src/components/workflows/useWorkflowSettingsClient.ts', 'settings-client.cjs');
const groups = await bundle('src/shared/macroLibraryGroups.ts', 'groups.cjs');

const templateState = (templates, categories = []) => ({ revision: 3, cursor: 'c3', categories, templates });
const savedTemplate = (id, extra = {}) => ({
	id,
	name: `Flow ${id}`,
	description: '',
	category: '',
	openingPrompt: '',
	steps: [{ id: `${id}-s1`, title: 'Explore', prompt: 'look around', icon: '' }],
	...extra,
});

test('the library groups by category, shows step counts, and the filter reaches step prompts', () => {
	const draft = library.draftFrom(
		templateState(
			[
				savedTemplate('a', { category: 'OpenSpec', steps: [{ id: 's1', title: 'Propose', prompt: 'write the proposal', icon: '' }, { id: 's2', title: 'Apply', prompt: 'zebracorn', icon: '' }] }),
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

test('Alt+Arrow moves a step by one place and never past either end', () => {
	assert.deepEqual(library.moveBy(['a', 'b', 'c'], 2, -1), ['a', 'c', 'b']);
	const same = ['a', 'b'];
	assert.equal(library.moveBy(same, 0, -1), same);
	assert.equal(library.moveBy(same, 1, 1), same);
	assert.deepEqual(library.moveBefore(['a', 'b', 'c'], 0, 3), ['b', 'c', 'a']);
	assert.deepEqual(library.moveBefore(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
	const markup = renderToStaticMarkup(
		React.createElement(category.StepList, {
			editor: { addStep() {}, removeStep() {}, updateStep() {}, moveStep() {}, reorderSteps() {} },
			template: library.draftFrom(templateState([savedTemplate('a')])).templates[0],
		}),
	);
	assert.match(markup, /aria-label="Move step 1" aria-keyshortcuts="Alt\+ArrowUp Alt\+ArrowDown"/);
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
	assert.ok(markup.includes(preview.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;')));
	assert.ok(!/collapse|expanded/i.test(markup), 'no template field chooses how the panel opens');
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

const commandBar = await bundle('src/workspace/CommandBar.tsx', 'command-bar.cjs');
const commands = await bundle('src/workspace/workflows/commandBarWorkflows.tsx', 'command-workflows.cjs');

const templateFor = (id, name, category = '') => ({
	id, name, description: '', category, openingPrompt: '', revision: 1,
	steps: [{ id: `${id}-1`, title: 'Investigate', prompt: '', icon: '' }],
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
