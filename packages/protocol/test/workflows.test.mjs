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
