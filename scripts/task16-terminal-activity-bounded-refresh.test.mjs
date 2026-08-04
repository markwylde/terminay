import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const controller = await readFile(
	new URL('../src/workspace/useTerminalActivityController.ts', import.meta.url),
	'utf8',
);

test('activity evaluation callbacks remain stable across workspace rerenders', () => {
	assert.match(
		controller,
		/const applyPanelStateRef = useRef\(applyPanelState\)/,
	);
	assert.match(controller, /const getEvaluationRef = useRef\(getEvaluation\)/);
	assert.match(
		controller,
		/const onOverviewChangedRef = useRef\(onOverviewChanged\)/,
	);
	assert.match(
		controller,
		/const applyEvaluation = useCallback\([\s\S]*?\n\t\t\[\],\n\t\)/,
	);
	assert.match(
		controller,
		/const evaluate = useCallback\([\s\S]*?\n\t\t\[applyEvaluation\],\n\t\)/,
	);
	assert.doesNotMatch(controller, /\[applyPanelState,\s*onOverviewChanged\]/);
	assert.doesNotMatch(controller, /\[applyEvaluation,\s*getEvaluation\]/);
});
