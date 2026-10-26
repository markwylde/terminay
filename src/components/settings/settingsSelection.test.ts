import assert from 'node:assert/strict';
import test from 'node:test';
import { rememberSelection } from './settingsSelection.ts';

test('returning to a category restores the item chosen there', () => {
	let selection = rememberSelection({}, 'remote', 'server-b');
	selection = rememberSelection(selection, 'macros', 'macro-3');
	// Visiting Appearance and coming back changes nothing.
	assert.equal(selection.remote, 'server-b');
	assert.equal(selection.macros, 'macro-3');
});

test('choosing the same item again keeps the same selection object', () => {
	const selection = rememberSelection({}, 'macros', 'macro-1');
	assert.equal(rememberSelection(selection, 'macros', 'macro-1'), selection);
});
