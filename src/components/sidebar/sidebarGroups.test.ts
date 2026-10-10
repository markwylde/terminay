import assert from 'node:assert/strict';
import test from 'node:test';
import {
	applySidebarGroupReorder,
	panelsInSidebarGroup,
	SIDEBAR_GROUP_IDS,
	sidebarGroupForPanel,
} from './sidebarGroups.ts';

test('Explorer group keeps Files then Git from a mixed panel order', () => {
	assert.deepEqual(
		panelsInSidebarGroup('explorer', [
			'explorer',
			'agents',
			'git',
			'documentation',
		]),
		['explorer', 'git'],
	);
	assert.equal(sidebarGroupForPanel('git'), 'explorer');
	assert.equal(sidebarGroupForPanel('documentation'), 'documentation');
});

test('reordering Git above Files stays inside the Explorer group', () => {
	assert.deepEqual(
		applySidebarGroupReorder(
			['explorer', 'agents', 'git', 'documentation'],
			'explorer',
			['git', 'explorer'],
		),
		['git', 'agents', 'explorer', 'documentation'],
	);
});

test('the sidebar has two groups, and the Agents pane is in neither', () => {
	assert.deepEqual([...SIDEBAR_GROUP_IDS], ['explorer', 'documentation']);
	assert.equal(sidebarGroupForPanel('agents'), undefined);
	const order = ['explorer', 'agents', 'git', 'documentation'] as const;
	assert.equal(
		SIDEBAR_GROUP_IDS.some((groupId) =>
			panelsInSidebarGroup(groupId, order).includes('agents'),
		),
		false,
	);
});
