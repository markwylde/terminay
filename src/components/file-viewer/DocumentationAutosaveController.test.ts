import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentationAutosaveController } from './DocumentationAutosaveController.ts';

// The controller is intentionally DOM-light; this makes its ordering contract
// testable without mounting MDXEditor.
(globalThis as { window: Pick<Window, 'setTimeout' | 'clearTimeout'> }).window = {
	setTimeout: globalThis.setTimeout as unknown as Window['setTimeout'],
	clearTimeout: globalThis.clearTimeout as unknown as Window['clearTimeout'],
};

test('documentation autosave serializes edits that arrive during a save', async () => {
	const states: string[] = [];
	let resolveFirst!: () => void;
	let calls = 0;
	const controller = new DocumentationAutosaveController(async () => {
		calls += 1;
		if (calls === 1) await new Promise<void>((resolve) => { resolveFirst = resolve; });
	}, (state) => states.push(state), 1);
	controller.changed();
	const first = controller.flush();
	controller.changed();
	resolveFirst();
	assert.equal(await first, true);
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(calls, 2);
	assert.deepEqual(states.slice(0, 4), ['dirty', 'saving', 'dirty', 'dirty']);
	controller.dispose();
});

test('documentation autosave preserves a failed revision for a later flush', async () => {
	const states: string[] = [];
	let calls = 0;
	const controller = new DocumentationAutosaveController(async () => {
		calls += 1;
		if (calls === 1) throw new Error('disk conflict');
	}, (state) => states.push(state), 1);
	controller.changed();
	assert.equal(await controller.flush(), false);
	assert.equal(states.at(-1), 'conflict');
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(calls, 1);
	controller.dispose();
});
