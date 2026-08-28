import assert from 'node:assert/strict';
import test from 'node:test';
import {
	applySidebarGroupReorder,
	panelsInSidebarGroup,
	resolveVisibleSidebarGroup,
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

test('Agents falls back to Explorer when agent integration is disabled', () => {
	assert.equal(resolveVisibleSidebarGroup('agents', false), 'explorer');
	assert.equal(resolveVisibleSidebarGroup('agents', true), 'agents');
	assert.equal(resolveVisibleSidebarGroup('documentation', false), 'documentation');
});
