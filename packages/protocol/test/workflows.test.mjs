import assert from 'node:assert/strict';
import test from 'node:test';
import {
	composeWorkflowGoal,
	flattenTypedText,
	typedWorkflowGoal,
	WORKFLOW_LAUNCH_INSTRUCTION,
	WORKFLOW_RESUME_INSTRUCTION,
} from '../dist/index.js';

test('the typed goal is the composed goal on one line', () => {
	const opening = 'First paragraph.\n\nSecond paragraph.';
	assert.equal(
		typedWorkflowGoal(opening, WORKFLOW_LAUNCH_INSTRUCTION),
		`/goal First paragraph. Second paragraph. ${WORKFLOW_LAUNCH_INSTRUCTION}`,
	);
	assert.equal(
		typedWorkflowGoal('', WORKFLOW_RESUME_INSTRUCTION),
		`/goal ${WORKFLOW_RESUME_INSTRUCTION}`,
	);
	assert.equal(
		typedWorkflowGoal('  Ship it.  ', 'Go.'),
		flattenTypedText(composeWorkflowGoal('  Ship it.  ', 'Go.')),
	);
});

test('line breaks, tabs and the whitespace around them become one space', () => {
	assert.equal(flattenTypedText('a\nb'), 'a b');
	assert.equal(flattenTypedText('a\r\nb'), 'a b');
	assert.equal(flattenTypedText('a\rb'), 'a b');
	assert.equal(flattenTypedText('a\tb'), 'a b');
	assert.equal(flattenTypedText('a  \n \n\t  b'), 'a b');
	assert.equal(flattenTypedText('\n lead and trail \n'), 'lead and trail');
	// Spaces with no line break or tab are kept as written.
	assert.equal(flattenTypedText('a  b'), 'a  b');
	assert.ok(!/[\r\n\t]/.test(typedWorkflowGoal('x\n\ty\r\nz', WORKFLOW_LAUNCH_INSTRUCTION)));
});

test('characters are typed as stored, without normalisation', () => {
	const decomposed = 'Café — 日本語 😀';
	assert.equal(flattenTypedText(decomposed), decomposed);
	assert.ok(typedWorkflowGoal(decomposed, 'Go.').includes(decomposed));
});

test('launch and resume instructions follow dependencies (ADR-0127)', () => {
	for (const instruction of [WORKFLOW_LAUNCH_INSTRUCTION, WORKFLOW_RESUME_INSTRUCTION]) {
		assert.match(instruction, /only once every step in its after list is done or skipped/u);
		assert.match(instruction, /ready_step_ids/u);
		assert.match(instruction, /at the same time/u);
	}
	// The largest opening prompt still fits the 16 KiB launch bound.
	const text = composeWorkflowGoal('p'.repeat(8 * 1024), WORKFLOW_LAUNCH_INSTRUCTION);
	assert.ok(Buffer.byteLength(text, 'utf8') <= 16 * 1024);
});
