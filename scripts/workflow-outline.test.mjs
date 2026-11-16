import assert from 'node:assert/strict';
import test from 'node:test';
import {
	effectiveSteps,
	templateInput,
	templateProblems,
	withSteps,
} from '../src/components/workflows/workflowLibraryModel.ts';
import {
	addAlongside,
	addAtEnd,
	addThen,
	addTrack,
	dependenciesFromOutline,
	impliedLinkCount,
	moveBeforeInTrack,
	moveWithinTrack,
	outlineFromSteps,
	outlineKeys,
	removeStep,
} from '../src/components/workflows/workflowOutlineModel.ts';

// The template outline and the dependencies it sets (ADR-0128).

const s = (id, ...after) => ({ id, after });
const after = (outline) => Object.fromEntries(dependenciesFromOutline(outline));

test('opening a template draws it as the panel would', () => {
	assert.deepEqual(outlineFromSteps([s('p'), s('r', 'p')]), ['p', 'r']);
	assert.deepEqual(outlineFromSteps([s('p'), s('c', 'p'), s('s', 'p'), s('a', 'c', 's')]), [
		'p',
		{ tracks: [['c'], ['s']] },
		'a',
	]);
});

test('"+ alongside" on a step in sequence makes a bracket; each waits on what came before', () => {
	const outline = addAlongside(['p', 'r'], 'r', 'sr');
	assert.deepEqual(outline, ['p', { tracks: [['r'], ['sr']] }]);
	assert.deepEqual(after(outline), { p: [], r: ['p'], sr: ['p'] });
});

test('"+ alongside" on a step alone in its track adds a track to that bracket', () => {
	const outline = addAlongside(['p', { tracks: [['c'], ['s']] }], 's', 'x');
	assert.deepEqual(outline, ['p', { tracks: [['c'], ['s'], ['x']] }]);
});

test('"+ alongside" on a step in a longer track nests a bracket in it', () => {
	const outline = addAlongside(['p', { tracks: [['a', 'b'], ['c']] }], 'b', 'x');
	assert.deepEqual(outline, ['p', { tracks: [['a', { tracks: [['b'], ['x']] }], ['c']] }]);
	assert.deepEqual(after(outline).x, ['a']);
});

test('a step after a bracket waits on the last step of each track', () => {
	const outline = addAtEnd(['p', { tracks: [['c', 'c2'], ['s']] }], 'amend');
	assert.deepEqual(after(outline).amend, ['c2', 's']);
	assert.deepEqual(after(outline).c2, ['c']);
	assert.deepEqual(after(outline).s, ['p']);
});

test('"+ then" adds a step directly after another in its track', () => {
	const outline = addThen(['p', { tracks: [['c'], ['s']] }, 'a'], 'c', 'c2');
	assert.deepEqual(outline, ['p', { tracks: [['c', 'c2'], ['s']] }, 'a']);
	assert.deepEqual(after(outline).a, ['c2', 's']);
});

test('"+ another track alongside" gives a bracket of two a third track of one new step', () => {
	const outline = addTrack(['p', { tracks: [['c'], ['s']] }], 'c', 'n');
	assert.deepEqual(outline, ['p', { tracks: [['c'], ['s'], ['n']] }]);
});

test("removing a track's only step removes the track, and a one-track bracket becomes a sequence", () => {
	const outline = removeStep(['p', { tracks: [['c'], ['s']] }, 'a'], 's');
	assert.deepEqual(outline, ['p', 'c', 'a']);
	assert.deepEqual(removeStep(['p', { tracks: [['c', 'd'], ['s']] }], 's'), ['p', 'c', 'd']);
	assert.deepEqual(removeStep(['p', 'q'], 'p'), ['q']);
});

test('a step moves within its track, never out of it', () => {
	const outline = ['p', { tracks: [['a', 'b', 'c'], ['s']] }];
	assert.deepEqual(moveWithinTrack(outline, 'c', -1), ['p', { tracks: [['a', 'c', 'b'], ['s']] }]);
	assert.equal(moveWithinTrack(outline, 'a', -1), outline);
	assert.equal(moveWithinTrack(outline, 's', 1), outline);
	assert.deepEqual(moveBeforeInTrack(outline, 'c', 'a'), ['p', { tracks: [['c', 'a', 'b'], ['s']] }]);
	assert.deepEqual(moveBeforeInTrack(outline, 'a', null), ['p', { tracks: [['b', 'c', 'a'], ['s']] }]);
	// Another track's step is not a place to drop.
	assert.equal(moveBeforeInTrack(outline, 'a', 's'), outline);
	// Before a bracket, named by its first step.
	assert.deepEqual(moveBeforeInTrack(['p', { tracks: [['a'], ['b']] }, 'z'], 'z', 'a'), ['p', 'z', { tracks: [['a'], ['b']] }]);
});

test('steps are saved in outline order, a track before the next', () => {
	assert.deepEqual(outlineKeys(['p', { tracks: [['c', 'c2'], ['s']] }, 'a']), ['p', 'c', 'c2', 's', 'a']);
});

// Saving keeps stored dependencies until the shape changes.

const step = (key, ...waits) => ({ key, id: key, title: key.toUpperCase(), prompt: '', icon: '', after: waits });
const partial = withSteps({ id: 't', name: 'T', description: '', category: '', openingPrompt: '' }, [
	step('amend'),
	step('server', 'amend'),
	step('ui', 'amend'),
	step('docs', 'amend'),
	step('verify', 'server', 'ui'),
	step('e2e', 'ui'),
	step('pr', 'verify', 'e2e', 'docs'),
]);

test('editing a prompt keeps a partial dependency', () => {
	const edited = { ...partial, steps: partial.steps.map((item) => (item.key === 'e2e' ? { ...item, prompt: 'new' } : item)) };
	const input = templateInput(edited);
	assert.deepEqual(input.steps.find((item) => item.id === 'e2e').after, ['ui']);
});

test('changing the shape replaces it with what the outline implies', () => {
	const outline = addAtEnd(partial.outline, 'ship');
	const changed = {
		...partial,
		outline,
		steps: [...partial.steps, { key: 'ship', title: 'Ship', prompt: '', icon: '', after: [] }],
		shapeChanged: true,
	};
	const steps = effectiveSteps(changed);
	assert.deepEqual(steps.find((item) => item.key === 'e2e').after, ['server', 'ui']);
	const input = templateInput(changed);
	// The new step is last, waiting on PR: the default, so after is left out, and it needs no name.
	assert.equal(input.steps.at(-1).title, 'Ship');
	assert.equal('after' in input.steps.at(-1), false);
	assert.equal('id' in input.steps.at(-1), false);
});

test('a new step another step waits on is sent with its editor key as its name', () => {
	const base = withSteps({ id: 't', name: 'T', description: '', category: '', openingPrompt: '' }, [step('p')]);
	const outline = addAlongside(addAtEnd(base.outline, 'row-1'), 'row-1', 'row-2');
	const changed = {
		...base,
		outline: addAtEnd(outline, 'row-3'),
		steps: [
			...base.steps,
			...['row-1', 'row-2', 'row-3'].map((key) => ({ key, title: key, prompt: '', icon: '', after: [] })),
		],
		shapeChanged: true,
	};
	const input = templateInput(changed);
	assert.deepEqual(
		input.steps.map((item) => [item.id, item.after]),
		[
			['p', undefined],
			['row-1', undefined],
			['row-2', ['p']],
			[undefined, ['row-1', 'row-2']],
		],
	);
});

test('an outline that implies too many dependencies is refused before save, naming the count and the bound', () => {
	const roots = Array.from({ length: 25 }, (_, index) => step(`r${index}`));
	const leaves = Array.from({ length: 25 }, (_, index) => step(`l${index}`, `r${index}`, `r${(index + 1) % 25}`));
	const template = withSteps({ id: 't', name: 'Wide', description: '', category: '', openingPrompt: '' }, [...roots, ...leaves]);
	assert.equal(impliedLinkCount(template.outline), 625);
	// Stored, it has 50 dependencies and saves.
	assert.deepEqual(templateProblems(template), []);
	const outline = removeStep(template.outline, 'l24');
	const changed = { ...template, outline, steps: template.steps.filter((item) => item.key !== 'l24'), shapeChanged: true };
	assert.equal(impliedLinkCount(outline), 600);
	assert.deepEqual(templateProblems(changed), [
		'“Wide”: the outline implies 600 dependencies; a workflow may have at most 200.',
	]);
});
