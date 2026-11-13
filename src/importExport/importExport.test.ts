import assert from 'node:assert/strict';
import test from 'node:test';
import {
	BundleError,
	bundleSnapshot,
	decodeBundle,
	encodeBundle,
	withDependencies,
} from './bundle.ts';
import {
	type ImportExportClients,
	PORTABLE_SETTINGS_CATEGORIES,
	readColumn,
	settingsCategoriesToPortable,
	settingsCategoryKeys,
	validatePortable,
} from './kinds.ts';
import {
	buildMatrix,
	defaultSourceId,
	filterRows,
	type MatrixColumn,
	retainSelection,
	reviewStillValid,
} from './matrix.ts';
import { fingerprint, itemKey, nextFreeName, type PortableItem } from './model.ts';
import { applyPlan, buildPlan, type Decision, planIsDecided } from './plan.ts';

// ---------------------------------------------------------------------------
// A fake server holding every kind, with revision guards like the real one.

type Macro = {
	id: string;
	title: string;
	description: string;
	category: string;
	fields: Record<string, unknown>[];
	steps: Record<string, unknown>[];
};
type Template = {
	id: string;
	name: string;
	description: string;
	category: string;
	openingPrompt: string;
	steps: { id: string; title: string; prompt: string; icon: string }[];
};
type Profile = {
	id: string;
	name: string;
	target: unknown;
	args: string[];
	startupMode: string;
	environment: Record<string, string | null>;
};
type Automation = {
	id: string;
	name: string;
	enabled: boolean;
	trigger: unknown;
	action: Record<string, unknown>;
	settings: Record<string, unknown>;
};

class Conflict extends Error {
	readonly code = 'conflict';
}

function fakeServer(
	init: Partial<{
		macros: Macro[];
		categories: string[];
		templates: Template[];
		profiles: Profile[];
		automations: Automation[];
		settings: Record<string, unknown>;
	}> = {},
) {
	const state = {
		macroRevision: 1,
		macros: init.macros ?? [],
		categories: init.categories ?? [],
		templateRevision: 1,
		templates: init.templates ?? [],
		templateCategories: [] as string[],
		settingsRevision: 1,
		profiles: init.profiles ?? [],
		automationRevision: 1,
		automations: init.automations ?? [],
		settings: init.settings ?? {},
		writes: 0,
		failMacroTitle: undefined as string | undefined,
	};
	const check = (expected: number | undefined, actual: number) => {
		if (expected !== undefined && expected !== actual) throw new Conflict('stale');
	};
	const macroState = () => ({
		revision: state.macroRevision,
		categories: [...state.categories],
		macros: structuredClone(state.macros),
	});
	const templateState = () => ({
		revision: state.templateRevision,
		categories: [...state.templateCategories],
		templates: structuredClone(state.templates),
	});
	const catalogue = () => ({
		settingsRevision: state.settingsRevision,
		entries: state.profiles.map((profile) => ({ id: profile.id, name: profile.name, kind: 'custom' })),
	});
	let profileCounter = 0;
	let automationCounter = 0;
	const clients: ImportExportClients = {
		macros: {
			get: async () => macroState(),
			async upsert(macro, options) {
				check(options.expectedRevision, state.macroRevision);
				const value = macro as Macro;
				if (value.title === state.failMacroTitle) throw new Error('macro refused');
				state.macros = [...state.macros.filter((m) => m.id !== value.id), value];
				state.macroRevision += 1;
				state.writes += 1;
				return macroState();
			},
			async replace(macros, options) {
				check(options.expectedRevision, state.macroRevision);
				state.macros = macros as Macro[];
				if (options.categories) state.categories = [...options.categories];
				state.macroRevision += 1;
				state.writes += 1;
				return macroState();
			},
		},
		workflows: {
			templates: async () => templateState(),
			async upsertTemplate(template, options) {
				check(options.expectedRevision, state.templateRevision);
				const value = template as unknown as Template & { steps: { title: string; prompt: string; icon: string; id?: string }[] };
				assert.ok(value.steps.every((step) => step.id === undefined), 'step ids are left to the server');
				const stored = { ...value, steps: value.steps.map((step, i) => ({ ...step, id: `s${i}` })) };
				state.templates = [...state.templates.filter((t) => t.id !== value.id), stored];
				state.templateRevision += 1;
				state.writes += 1;
				return templateState();
			},
			async reorderTemplates(_ids, categories, options) {
				check(options.expectedRevision, state.templateRevision);
				if (categories) state.templateCategories = [...categories];
				state.templateRevision += 1;
				return templateState();
			},
		},
		shellProfiles: {
			catalogue: async () => catalogue(),
			detail: async (id) => structuredClone(state.profiles.find((profile) => profile.id === id)!),
			async create(profile, options) {
				check(options.expectedRevision, state.settingsRevision);
				profileCounter += 1;
				state.profiles.push({ ...(profile as unknown as Profile), id: `profile:new${profileCounter}` });
				state.settingsRevision += 1;
				state.writes += 1;
				return catalogue();
			},
			async update(profile, options) {
				check(options.expectedRevision, state.settingsRevision);
				const value = profile as unknown as Profile;
				state.profiles = state.profiles.map((p) => (p.id === value.id ? value : p));
				state.settingsRevision += 1;
				state.writes += 1;
				return catalogue();
			},
			validate: async (profile) => {
				const target = (profile as unknown as Profile).target as { executable?: string };
				return target.executable === '/missing'
					? { valid: false, issues: [{ message: 'shell not found' }] }
					: { valid: true, issues: [] };
			},
		},
		automations: {
			get: async () => ({ revision: state.automationRevision, automations: structuredClone(state.automations) }),
			async upsert(automation, options) {
				check(options.expectedRevision, state.automationRevision);
				const value = automation as unknown as Automation;
				const id = value.id ?? `auto-${++automationCounter}`;
				state.automations = [...state.automations.filter((a) => a.id !== id), { ...value, id }];
				state.automationRevision += 1;
				state.writes += 1;
				return { revision: state.automationRevision, automations: structuredClone(state.automations) };
			},
		},
		settings: {
			get: async () => ({ revision: state.settingsRevision, settings: structuredClone(state.settings), secretReferences: {} }),
			async update(patch, options) {
				check(options.expectedRevision, state.settingsRevision);
				const merge = (into: Record<string, unknown>, from: Record<string, unknown>) => {
					for (const [key, value] of Object.entries(from)) {
						if (value && typeof value === 'object' && !Array.isArray(value)) {
							into[key] = into[key] && typeof into[key] === 'object' ? into[key] : {};
							merge(into[key] as Record<string, unknown>, value as Record<string, unknown>);
						} else into[key] = value;
					}
				};
				merge(state.settings, patch as unknown as Record<string, unknown>);
				state.settingsRevision += 1;
				state.writes += 1;
				return { revision: state.settingsRevision };
			},
		},
	};
	return { state, clients };
}

const macro = (id: string, title: string, content = 'make build', category = ''): Macro => ({
	id,
	title,
	description: '',
	category,
	fields: [],
	steps: [{ id: `${id}-s1`, type: 'type', content }],
});

const template = (id: string, name: string, steps: string[]): Template => ({
	id,
	name,
	description: '',
	category: '',
	openingPrompt: '',
	steps: steps.map((title, i) => ({ id: `${id}-${i}`, title, prompt: '', icon: '' })),
});

const automationRunning = (id: string, macroId: string, enabled = true): Automation => ({
	id,
	name: 'Nightly prune',
	enabled,
	trigger: { kind: 'schedule', cron: '0 2 * * *' },
	action: { kind: 'runMacro', macroId, fieldValues: {} },
	settings: { keepTerminalAfterRun: false, recordSession: false, cooldownSeconds: 0 },
});

async function columns(servers: Record<string, ReturnType<typeof fakeServer>>): Promise<MatrixColumn[]> {
	return Promise.all(
		Object.entries(servers).map(async ([id, server]) => ({
			id,
			label: id,
			readOnly: false,
			ready: true,
			snapshot: await readColumn(server.clients),
		})),
	);
}

function cell(rows: ReturnType<typeof buildMatrix>, key: string, column: string) {
	const row = rows.find((r) => r.key === key);
	assert.ok(row, `row ${key}`);
	return row.cells[column].state;
}

// ---------------------------------------------------------------------------

test('keys fold name case; fingerprints keep content case and ignore ids and key order', () => {
	assert.equal(itemKey('macro', '  Deploy '), itemKey('macro', 'deploy'));
	const a: PortableItem = { kind: 'macro', name: 'x', content: { b: 1, a: 'make Build' } };
	const b: PortableItem = { kind: 'macro', name: 'x', content: { a: 'make Build', b: 1 } };
	const c: PortableItem = { kind: 'macro', name: 'x', content: { a: 'make build', b: 1 } };
	assert.equal(fingerprint(a), fingerprint(b));
	assert.notEqual(fingerprint(a), fingerprint(c));
	assert.equal(nextFreeName('macro', 'Count', new Set([itemKey('macro', 'Count (2)')])), 'Count (3)');
});

test('matrix: present on two of three, same name different content, different ids', async () => {
	const local = fakeServer({
		macros: [macro('m1', 'Deploy staging')],
		templates: [template('t1', 'Count', ['1', '2', '3', '4'])],
	});
	const vms = fakeServer({
		macros: [macro('other-id', 'Deploy staging')],
		templates: [template('t9', 'Count', ['1', '2', '3'])],
	});
	const build = fakeServer();
	const rows = buildMatrix(await columns({ local, vms, build }), 'local');
	assert.equal(cell(rows, 'macro:deploy staging', 'local'), 'present');
	assert.equal(cell(rows, 'macro:deploy staging', 'vms'), 'same');
	assert.equal(cell(rows, 'macro:deploy staging', 'build'), 'missing');
	assert.equal(cell(rows, 'workflowTemplate:count', 'vms'), 'differs');
});

test('matrix: content case differs, automation enabled state ignored, duplicates, column states', async () => {
	const local = fakeServer({
		macros: [macro('m1', 'deploy', 'make Build'), macro('c', 'Clean worktrees'), macro('b1', 'Build'), macro('b2', 'build')],
		automations: [automationRunning('a1', 'c', true)],
	});
	const vms = fakeServer({
		macros: [macro('m2', 'Deploy', 'make build'), macro('c2', 'Clean worktrees')],
		automations: [automationRunning('a9', 'c2', false)],
	});
	const cols = await columns({ local, vms });
	cols.push({ id: 'off', label: 'off', readOnly: false, ready: false, phase: 'unreachable' });
	const rows = buildMatrix(cols, 'local');
	assert.equal(cell(rows, 'macro:deploy', 'vms'), 'differs');
	assert.equal(cell(rows, 'automation:nightly prune', 'vms'), 'same');
	assert.equal(cell(rows, 'macro:build', 'local'), 'duplicate');
	assert.equal(rows.find((r) => r.key === 'macro:build')?.sourceItem, undefined);
	assert.equal(cell(rows, 'macro:deploy', 'off'), 'notReady');
});

test('matrix: unsupported and denied kinds', async () => {
	const local = fakeServer({ templates: [template('t1', 'Count', ['a'])] });
	const old = fakeServer();
	const { workflows: _w, ...noWorkflows } = old.clients;
	const denied = fakeServer();
	const deniedClients: ImportExportClients = {
		...denied.clients,
		shellProfiles: {
			...denied.clients.shellProfiles!,
			catalogue: async () => {
				throw Object.assign(new Error('no'), { code: 'forbidden' });
			},
		},
	};
	const cols: MatrixColumn[] = [
		{ id: 'local', label: 'local', readOnly: false, ready: true, snapshot: await readColumn(local.clients) },
		{ id: 'old', label: 'old', readOnly: false, ready: true, snapshot: await readColumn(noWorkflows) },
		{ id: 'denied', label: 'denied', readOnly: false, ready: true, snapshot: await readColumn(deniedClients) },
	];
	assert.equal(cols[2].snapshot!.shellProfile.state, 'denied');
	const rows = buildMatrix(cols, 'local');
	assert.equal(cell(rows, 'workflowTemplate:count', 'old'), 'unsupported');
});

test('filters, default source, selection retention, review validity', async () => {
	const local = fakeServer({ macros: [macro('m1', 'Tail logs'), macro('m2', 'Deploy')] });
	const vms = fakeServer({ macros: [macro('x', 'Tail logs')] });
	const cols = await columns({ local, vms });
	const rows = buildMatrix(cols, 'local');
	const onlyDiff = filterRows(rows, { kinds: new Set(), text: '', onlyDifferences: true }, 'local');
	assert.deepEqual(onlyDiff.map((r) => r.name), ['Deploy']);
	assert.deepEqual(filterRows(rows, { kinds: new Set(['macro']), text: 'tail', onlyDifferences: false }, 'local').map((r) => r.name), ['Tail logs']);
	assert.equal(defaultSourceId(cols, 'vms', 'local'), 'vms');
	assert.equal(defaultSourceId(cols, undefined, 'local'), 'local');
	assert.deepEqual([...retainSelection(new Set(['macro:deploy', 'macro:gone']), rows)], ['macro:deploy']);
	assert.equal(reviewStillValid(cols, 'local', ['vms']), true);
	assert.equal(reviewStillValid([cols[0], { ...cols[1], ready: false }], 'local', ['vms']), false);
});

test('review: clashes need a choice; settings offer only Replace and Skip; up to date writes nothing', async () => {
	const local = fakeServer({
		macros: [macro('m1', 'Deploy', 'v2'), macro('m2', 'Same')],
		settings: { fontSize: 14, fontFamily: 'Mono' },
	});
	const vms = fakeServer({ macros: [macro('x1', 'Deploy', 'v1'), macro('x2', 'Same')], settings: { fontSize: 12 } });
	const cols = await columns({ local, vms });
	const rows = buildMatrix(cols, 'local');
	const appearance = rows.find((r) => r.kind === 'settingsCategory');
	const selected = new Set(['macro:deploy', 'macro:same', ...(appearance ? [appearance.key] : [])]);
	const plan = buildPlan({ sourceId: 'local', source: cols[0].snapshot!, rows, selectedKeys: selected, targets: [{ id: 'vms', snapshot: cols[1].snapshot! }] });
	const nodes = plan.targets[0].nodes;
	const deploy = nodes.find((n) => n.key === 'macro:deploy')!;
	assert.equal(deploy.status, 'clash');
	assert.deepEqual(deploy.choices, ['replace', 'keepBoth', 'skip']);
	assert.equal(nodes.find((n) => n.key === 'macro:same')!.status, 'upToDate');
	const settingsNode = nodes.find((n) => n.kind === 'settingsCategory');
	if (settingsNode) assert.deepEqual(settingsNode.choices, ['replace', 'skip']);
	assert.equal(planIsDecided(plan, new Map(), new Map()), false);
	const decisions = new Map<string, Decision>(nodes.filter((n) => n.status === 'clash').map((n) => [n.id, 'replace']));
	assert.equal(planIsDecided(plan, decisions, new Map()), true);
	const writesBefore = vms.state.writes;
	const results = await applyPlan(plan, decisions, new Map(), () => vms.clients);
	assert.equal(results.find((r) => r.name === 'Same')!.outcome, 'upToDate');
	assert.equal(results.find((r) => r.name === 'Deploy')!.outcome, 'replaced');
	assert.ok(vms.state.macros.some((m) => m.id === 'x1' && (m.steps[0] as { content: string }).content === 'v2'), 'replace keeps the target id');
	assert.ok(vms.state.writes > writesBefore);
});

test('settings category Replace writes only that category and converges to same', async () => {
	const keys = settingsCategoryKeys('theme');
	assert.ok(keys.length > 0);
	const build = (value: string) => {
		const settings: Record<string, unknown> = {};
		for (const key of [...keys, 'remoteAccess.exposeOnStartup']) {
			const parts = key.split('.');
			let node = settings;
			for (const p of parts.slice(0, -1)) {
				node[p] ??= {};
				node = node[p] as Record<string, unknown>;
			}
			node[parts[parts.length - 1]] = `${value}:${key}`;
		}
		return settings;
	};
	const local = fakeServer({ settings: build('L') });
	const vms = fakeServer({ settings: build('V') });
	const cols = await columns({ local, vms });
	const rows = buildMatrix(cols, 'local');
	assert.equal(cell(rows, 'settingsCategory:theme', 'vms'), 'differs');
	const plan = buildPlan({ sourceId: 'local', source: cols[0].snapshot!, rows, selectedKeys: new Set(['settingsCategory:theme']), targets: [{ id: 'vms', snapshot: cols[1].snapshot! }] });
	const node = plan.targets[0].nodes[0];
	await applyPlan(plan, new Map([[node.id, 'replace']]), new Map(), () => vms.clients);
	const after = buildMatrix(await columns({ local, vms }), 'local');
	assert.equal(cell(after, 'settingsCategory:theme', 'vms'), 'same');
	assert.equal((vms.state.settings.remoteAccess as Record<string, unknown>).exposeOnStartup, 'V:remoteAccess.exposeOnStartup');
	const portable = settingsCategoriesToPortable({ revision: 1, settings: build('L') });
	assert.ok(portable.items.every((item) => (PORTABLE_SETTINGS_CATEGORIES as readonly string[]).includes(item.name)));
});

test('macros: add with a new category, Keep both naming, conflict is changed since review', async () => {
	const local = fakeServer({ macros: [macro('m1', 'Count', 'new', 'Deploy')], categories: ['Deploy'] });
	const vms = fakeServer({ macros: [macro('x1', 'Count', 'old'), macro('x2', 'Count (2)', 'z')] });
	const cols = await columns({ local, vms });
	const rows = buildMatrix(cols, 'local');
	const plan = buildPlan({ sourceId: 'local', source: cols[0].snapshot!, rows, selectedKeys: new Set(['macro:count']), targets: [{ id: 'vms', snapshot: cols[1].snapshot! }] });
	const node = plan.targets[0].nodes[0];
	const results = await applyPlan(plan, new Map([[node.id, 'keepBoth']]), new Map(), () => vms.clients);
	assert.equal(results[0].outcome, 'added');
	assert.ok(vms.state.macros.some((m) => m.title === 'Count (3)'));
	assert.ok(vms.state.categories.includes('Deploy'));
	assert.ok(vms.state.macros.some((m) => m.id === 'x1' && m.title === 'Count'), 'existing one is unchanged');

	// Another client edits between review and apply.
	const plan2 = buildPlan({ sourceId: 'local', source: cols[0].snapshot!, rows, selectedKeys: new Set(['macro:count']), targets: [{ id: 'vms', snapshot: cols[1].snapshot! }] });
	const stale = await applyPlan(plan2, new Map([[plan2.targets[0].nodes[0].id, 'replace']]), new Map(), () => vms.clients);
	assert.equal(stale[0].outcome, 'changedSinceReview');
});

test('templates: step ids omitted; shell profiles: custom only, validation warning', async () => {
	const local = fakeServer({
		templates: [template('t1', 'Count', ['a', 'b'])],
		profiles: [{ id: 'profile:1', name: 'Fish', target: { kind: 'executable', executable: '/missing' }, args: [], startupMode: 'default', environment: { A: '1' } }],
	});
	const vms = fakeServer();
	const cols = await columns({ local, vms });
	const rows = buildMatrix(cols, 'local');
	const plan = buildPlan({ sourceId: 'local', source: cols[0].snapshot!, rows, selectedKeys: new Set(['workflowTemplate:count', 'shellProfile:fish']), targets: [{ id: 'vms', snapshot: cols[1].snapshot! }] });
	const results = await applyPlan(plan, new Map(), new Map(), () => vms.clients);
	assert.deepEqual(results.map((r) => r.outcome), ['added', 'added']);
	assert.equal(vms.state.templates[0].steps.length, 2);
	assert.equal(vms.state.profiles[0].name, 'Fish');
	const { reviewWarnings } = await import('./kinds.ts');
	const warnings = await reviewWarnings(vms.clients, rows.find((r) => r.kind === 'shellProfile')!.sourceItem!.portable);
	assert.match(warnings.join(' '), /Unavailable/);
});

test('automations: disabled, dependency added, Keep both binding, failed dependency blocks', async () => {
	const local = fakeServer({ macros: [macro('c', 'Clean worktrees', 'v2')], automations: [automationRunning('a1', 'c', true)] });
	const empty = fakeServer();
	let cols = await columns({ local, empty });
	let rows = buildMatrix(cols, 'local');
	let plan = buildPlan({ sourceId: 'local', source: cols[0].snapshot!, rows, selectedKeys: new Set(['automation:nightly prune']), targets: [{ id: 'empty', snapshot: cols[1].snapshot! }] });
	assert.deepEqual(plan.targets[0].nodes.map((n) => [n.kind, n.dependency]), [['macro', true], ['automation', false]]);
	let results = await applyPlan(plan, new Map(), new Map(), () => empty.clients);
	assert.deepEqual(results.map((r) => r.outcome), ['added', 'added']);
	const newMacro = empty.state.macros[0];
	assert.equal(empty.state.automations[0].enabled, false);
	assert.equal(empty.state.automations[0].action.macroId, newMacro.id);

	// Keep both on a differing dependency binds to the new copy.
	const vms = fakeServer({ macros: [macro('old', 'Clean worktrees', 'v1')] });
	cols = await columns({ local, vms });
	rows = buildMatrix(cols, 'local');
	plan = buildPlan({ sourceId: 'local', source: cols[0].snapshot!, rows, selectedKeys: new Set(['automation:nightly prune', 'macro:clean worktrees']), targets: [{ id: 'vms', snapshot: cols[1].snapshot! }] });
	const dep = plan.targets[0].nodes.find((n) => n.kind === 'macro')!;
	results = await applyPlan(plan, new Map([[dep.id, 'keepBoth']]), new Map(), () => vms.clients);
	const copy = vms.state.macros.find((m) => m.title === 'Clean worktrees (2)')!;
	assert.equal(vms.state.automations[0].action.macroId, copy.id);

	// A failed dependency blocks its automation.
	const failing = fakeServer();
	failing.state.failMacroTitle = 'Clean worktrees';
	cols = await columns({ local, failing });
	rows = buildMatrix(cols, 'local');
	plan = buildPlan({ sourceId: 'local', source: cols[0].snapshot!, rows, selectedKeys: new Set(['automation:nightly prune', 'macro:clean worktrees']), targets: [{ id: 'failing', snapshot: cols[1].snapshot! }] });
	results = await applyPlan(plan, new Map(), new Map(), () => failing.clients);
	assert.deepEqual(results.map((r) => r.outcome), ['failed', 'blockedByDependency']);
	assert.equal(failing.state.automations.length, 0);
});

test('independent items continue after a failure', async () => {
	const local = fakeServer({ macros: [macro('a', 'Alpha'), macro('b', 'Beta')] });
	const vms = fakeServer();
	vms.state.failMacroTitle = 'Alpha';
	const cols = await columns({ local, vms });
	const rows = buildMatrix(cols, 'local');
	const plan = buildPlan({ sourceId: 'local', source: cols[0].snapshot!, rows, selectedKeys: new Set(['macro:alpha', 'macro:beta']), targets: [{ id: 'vms', snapshot: cols[1].snapshot! }] });
	const results = await applyPlan(plan, new Map(), new Map(), () => vms.clients);
	assert.deepEqual(results.map((r) => [r.name, r.outcome]), [['Alpha', 'failed'], ['Beta', 'added']]);
	assert.match(results[0].message ?? '', /macro refused/);
});

test('duplicate target needs a Replace pick', async () => {
	const local = fakeServer({ macros: [macro('m', 'Build', 'new')] });
	const vms = fakeServer({ macros: [macro('d1', 'Build', 'a'), macro('d2', 'build', 'b')] });
	const cols = await columns({ local, vms });
	const rows = buildMatrix(cols, 'local');
	const plan = buildPlan({ sourceId: 'local', source: cols[0].snapshot!, rows, selectedKeys: new Set(['macro:build']), targets: [{ id: 'vms', snapshot: cols[1].snapshot! }] });
	const node = plan.targets[0].nodes[0];
	const decisions = new Map<string, Decision>([[node.id, 'replace']]);
	assert.equal(planIsDecided(plan, decisions, new Map()), false);
	assert.equal(planIsDecided(plan, decisions, new Map([[node.id, 'd2']])), true);
	await applyPlan(plan, decisions, new Map([[node.id, 'd2']]), () => vms.clients);
	assert.equal((vms.state.macros.find((m) => m.id === 'd2')!.steps[0] as { content: string }).content, 'new');
});

test('bundle: round trip, automation-only export includes its macro, refusals', async () => {
	const local = fakeServer({ macros: [macro('c', 'Clean worktrees'), macro('x', 'Other')], automations: [automationRunning('a1', 'c')] });
	const snapshot = await readColumn(local.clients);
	const all = [...(snapshot.macro.state === 'ok' ? snapshot.macro.items : []), ...(snapshot.automation.state === 'ok' ? snapshot.automation.items : [])];
	const automationOnly = all.filter((item) => item.portable.kind === 'automation');
	const text = encodeBundle(withDependencies(automationOnly, all), 'Local', new Date(0));
	assert.ok(!/"id"|macroId|revision/.test(text), 'no ids or revisions');
	const bundle = decodeBundle(text);
	assert.deepEqual(bundle.items.map((i) => i.name).sort(), ['Clean worktrees', 'Nightly prune']);
	const rows = buildMatrix([
		{ id: 'local', label: 'Local', readOnly: false, ready: true, snapshot },
		{ id: 'file', label: 'file.json', readOnly: true, ready: true, snapshot: bundleSnapshot(bundle) },
	], 'local');
	assert.equal(cell(rows, 'macro:clean worktrees', 'file'), 'same');
	assert.equal(cell(rows, 'automation:nightly prune', 'file'), 'same');

	const good = JSON.parse(text);
	const refuse = (mutate: (b: Record<string, unknown>) => void, pattern: RegExp) => {
		const copy = structuredClone(good);
		mutate(copy);
		assert.throws(() => decodeBundle(JSON.stringify(copy)), (error: unknown) => error instanceof BundleError && pattern.test(error.message));
	};
	refuse((b) => { b.version = 2; }, /version 2/);
	refuse((b) => { b.format = 'x'; }, /not an Import/);
	refuse((b) => { (b.items as Record<string, unknown>[])[0].content = { ...(b.items as Record<string, Record<string, unknown>>[])[0].content, id: 'abc' }; }, /server id/);
	refuse((b) => { (b.items as Record<string, unknown>[]).push({ kind: 'bot', name: 'x', content: {} }); }, /unknown kind/);
	refuse((b) => { (b.items as unknown[]).push(structuredClone((b.items as unknown[])[0])); }, /Two items/);
	refuse((b) => { b.items = (b.items as { kind: string }[]).filter((i) => i.kind === 'automation'); }, /not in the bundle/);
	assert.throws(() => decodeBundle('{'), /not valid JSON/);
	assert.throws(() => decodeBundle(' '.repeat(4 * 1024 * 1024 + 1)), /4 MiB/);
});

test('validatePortable bounds', () => {
	assert.throws(() => validatePortable({ kind: 'workflowTemplate', name: 'x', content: { description: '', category: '', openingPrompt: '', steps: [] } }), /1 to 50 steps/);
	assert.throws(() => validatePortable({ kind: 'settingsCategory', name: 'remote', content: { values: {} } }), /cannot be copied|not a settings category/);
	assert.throws(() => validatePortable({ kind: 'settingsCategory', name: 'theme', content: { values: { 'remoteAccess.exposeOnStartup': true } } }), /outside its category/);
	assert.throws(() => validatePortable({ kind: 'macro', name: 'x', content: { description: 'a'.repeat(20_000), category: '', fields: [], steps: [] } }), /longer than/);
});
