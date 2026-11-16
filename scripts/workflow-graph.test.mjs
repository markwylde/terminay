import assert from 'node:assert/strict';
import test from 'node:test';
import {
	analyzeStages,
	groupTone,
	impliedDependencyCount,
	metroLayout,
	railWidth,
	stageDepth,
	stageIds,
	traceDependencies,
	unimpliedDependencies,
} from '../src/workspace/workflows/workflowGraph.ts';
import { currentStepLabel, currentSteps, currentStepTitle, readySteps } from '../src/workspace/workflows/workflowPanelModel.ts';

// The shape of a workflow worked out from its dependencies (ADR-0128).

const s = (id, ...after) => ({ id, after });
const chain = (...ids) => ids.map((id, index) => s(id, ...(index === 0 ? [] : [ids[index - 1]])));

// The example used throughout the proposal.
const propose = [
	s('propose'),
	s('codex', 'propose'),
	s('specs', 'propose'),
	s('amend', 'codex', 'specs'),
	s('server', 'amend'),
	s('ui', 'amend'),
	s('docs', 'amend'),
	s('verify', 'server', 'ui'),
	s('e2e', 'ui'),
	s('pr', 'verify', 'e2e', 'docs'),
	s('ci', 'pr'),
];

test('a plain list is one sequence with no bracket', () => {
	const { tree } = analyzeStages(chain('a', 'b', 'c', 'd'));
	assert.deepEqual(tree, ['a', 'b', 'c', 'd']);
	assert.equal(stageDepth(tree), 0);
	assert.equal(railWidth(tree), 36);
});

test('two reviews of one proposal are a bracket of two tracks, with no after text', () => {
	const steps = propose.slice(0, 4);
	const analysis = analyzeStages(steps);
	assert.deepEqual(analysis.tree, ['propose', { tracks: [['codex'], ['specs']] }, 'amend']);
	for (const step of steps) assert.deepEqual(unimpliedDependencies(analysis, step.id), []);
	assert.equal(railWidth(analysis.tree), 36);
});

test('a dependency the brackets cannot show is named, and only that one', () => {
	const analysis = analyzeStages(propose);
	assert.deepEqual(analysis.tree, [
		'propose',
		{ tracks: [['codex'], ['specs']] },
		'amend',
		{
			tracks: [
				[{ tracks: [['server'], ['ui']] }, { tracks: [['verify'], ['e2e']] }],
				['docs'],
			],
		},
		'pr',
		'ci',
	]);
	assert.deepEqual(unimpliedDependencies(analysis, 'e2e'), ['ui']);
	for (const step of propose.filter((item) => item.id !== 'e2e'))
		assert.deepEqual(unimpliedDependencies(analysis, step.id), [], step.id);
	assert.equal(stageDepth(analysis.tree), 2);
	assert.equal(railWidth(analysis.tree), 44);
	assert.deepEqual(stageIds(analysis.tree[3]), ['server', 'ui', 'verify', 'e2e', 'docs']);
});

test('the transitive reduction drops dependencies held through another', () => {
	const analysis = analyzeStages([s('a'), s('b', 'a'), s('c', 'a', 'b')]);
	assert.deepEqual(analysis.reduced.get('c'), ['b']);
	assert.deepEqual(analysis.tree, ['a', 'b', 'c']);
	assert.deepEqual(unimpliedDependencies(analysis, 'c'), []);
});

test('the rail width is capped at 72 pixels for deep nesting', () => {
	// Nest brackets six deep: each level is a pair of tracks, one of which holds the next level.
	const steps = [s('root')];
	let parent = 'root';
	for (let level = 0; level < 6; level += 1) {
		const left = `l${level}`;
		const right = `r${level}`;
		const tail = `t${level}`;
		steps.push(s(left, parent), s(right, parent), s(tail, left));
		parent = right;
	}
	const { tree } = analyzeStages(steps);
	assert.ok(stageDepth(tree) >= 6);
	assert.equal(railWidth(tree), 72);
});

test('a connected graph with no cut falls back to rank layers, and its implied count can exceed the bound', () => {
	const roots = Array.from({ length: 25 }, (_, index) => s(`r${index}`));
	const leaves = Array.from({ length: 25 }, (_, index) => s(`l${index}`, `r${index}`, `r${(index + 1) % 25}`));
	const analysis = analyzeStages([...roots, ...leaves]);
	assert.equal(analysis.tree.length, 2);
	assert.equal(analysis.tree[0].tracks.length, 25);
	assert.equal(analysis.tree[1].tracks.length, 25);
	assert.equal(impliedDependencyCount(analysis), 625);
	// Each leaf still names its two real dependencies.
	assert.deepEqual(unimpliedDependencies(analysis, 'l0'), ['r0', 'r1']);
});

test('tracing finds every step upstream and downstream', () => {
	const { upstream, downstream } = traceDependencies(propose, 'amend');
	assert.deepEqual([...upstream].sort(), ['codex', 'propose', 'specs']);
	assert.deepEqual([...downstream].sort(), ['ci', 'docs', 'e2e', 'pr', 'server', 'ui', 'verify']);
	const e2e = traceDependencies(propose, 'e2e');
	assert.equal(e2e.upstream.has('server'), false);
	assert.equal(e2e.upstream.has('ui'), true);
});

test('a bracket is red for input or failure, amber while running, green when settled', () => {
	assert.equal(groupTone(['running', 'needs_input']), 'alert');
	assert.equal(groupTone(['done', 'failed']), 'alert');
	assert.equal(groupTone(['running', 'not_started']), 'running');
	assert.equal(groupTone(['done', 'skipped']), 'done');
	assert.equal(groupTone(['done', 'not_started']), 'idle');
});

test('the metro map puts each step one column right of its furthest dependency', () => {
	const layout = metroLayout(propose.slice(0, 4));
	const at = (id) => [layout.nodes.get(id).column, layout.nodes.get(id).lane];
	assert.deepEqual(at('propose'), [0, 0]);
	assert.deepEqual(at('codex'), [1, 0]);
	assert.deepEqual(at('specs'), [1, 1]);
	assert.deepEqual(at('amend'), [2, 0]);
	assert.equal(layout.columns, 3);
	assert.equal(layout.lanes, 2);
	assert.equal(layout.edges.length, 4);
	const full = metroLayout(propose);
	assert.equal(full.nodes.get('e2e').column, 4);
	assert.equal(full.nodes.get('pr').column, 5);
});

// Current steps named in words (ADR-0128).

const st = (id, status, ...after) => ({ id, title: id, status, after });

test('several running steps are named first with how many more', () => {
	const steps = [st('Plan', 'done'), st('Server', 'running', 'Plan'), st('UI', 'running', 'Plan'), st('Docs', 'running', 'Plan')];
	assert.equal(currentStepLabel(steps), 'Server + 2 more');
	assert.equal(currentStepTitle(steps), 'Server + 2 more');
});

test('a step needing input is named first', () => {
	const steps = [st('Plan', 'done'), st('Server', 'running', 'Plan'), st('UI', 'running', 'Plan'), st('Docs', 'needs_input', 'Plan')];
	assert.deepEqual(currentSteps(steps).map((step) => step.id), ['Docs', 'Server', 'UI']);
	assert.equal(currentStepLabel(steps), 'Docs needs you + 2 more');
});

test('with nothing active the first failed step, else the first ready step, is current', () => {
	assert.equal(currentStepLabel([st('A', 'done'), st('B', 'failed', 'A'), st('C', 'not_started')]), 'B');
	// C waits on B, which is not settled; D waits on nothing and is ready.
	const steps = [st('A', 'done'), st('B', 'not_started', 'A'), st('C', 'not_started', 'B'), st('D', 'not_started')];
	assert.deepEqual(readySteps(steps).map((step) => step.id), ['B', 'D']);
	assert.equal(currentStepLabel(steps), 'B');
	assert.equal(currentStepLabel([st('A', 'done')]), undefined);
});
