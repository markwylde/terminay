import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	appliedOptions,
	countTabs,
	rowsForTab,
	viewOptionsLabel,
} from './compactSectionModel.ts';

type Row = { tone: 'alert' | 'running' | 'done' };
const rows: Row[] = [
	{ tone: 'alert' },
	{ tone: 'running' },
	{ tone: 'running' },
	{ tone: 'done' },
];
const tabs = [
	{ id: 'all', label: 'All' },
	{
		id: 'alert',
		label: 'Needs you',
		attention: true,
		test: (row: Row) => row.tone === 'alert',
	},
	{ id: 'running', label: 'Running', test: (row: Row) => row.tone === 'running' },
	{ id: 'done', label: 'Done', test: (row: Row) => row.tone === 'done' },
] as const;

test('each tab counts the rows it would show, and All counts every row', () => {
	assert.deepEqual(
		countTabs(rows, tabs).map((tab) => [tab.id, tab.count, tab.attention ?? false]),
		[
			['all', 4, false],
			['alert', 1, true],
			['running', 2, false],
			['done', 1, false],
		],
	);
});

test('a tab shows exactly the rows it counted', () => {
	assert.equal(rowsForTab(rows, tabs, 'running').length, 2);
	assert.equal(rowsForTab(rows, tabs, 'all').length, 4);
	assert.equal(rowsForTab([], tabs, 'done').length, 0);
});

test('nothing applied gives no token row and an unmarked control', () => {
	assert.equal(appliedOptions([false, undefined, null]), undefined);
	assert.equal(viewOptionsLabel(false), 'View options');
});

test('Clear resets every applied option, and each token resets its own', () => {
	const reset: string[] = [];
	const applied = appliedOptions([
		{ id: 'projects', label: 'api', reset: () => reset.push('projects') },
		false,
		{ id: 'finished', label: 'Finished hidden', reset: () => reset.push('finished') },
	]);
	assert.ok(applied);
	assert.deepEqual(
		applied.tokens.map((token) => token.id),
		['projects', 'finished'],
	);
	applied.tokens[1]?.reset();
	assert.deepEqual(reset, ['finished']);
	applied.clear();
	assert.deepEqual(reset, ['finished', 'projects', 'finished']);
	assert.equal(viewOptionsLabel(true), 'View options, filters applied');
});
