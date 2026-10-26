import assert from 'node:assert/strict';
import test from 'node:test';
import { groupSettingsCategories } from './settingsCategoryGroups.ts';

const all = [
	'ai', 'recording', 'remote', 'shell', 'files', 'appearance', 'cursor',
	'interaction', 'keyboard', 'scrolling', 'accessibility', 'theme', 'updates',
	'macros', 'extensions', 'diagnostics',
].map((id) => ({ id, label: id }));

test('groups are drawn in their fixed order', () => {
	assert.deepEqual(
		groupSettingsCategories(all).map((group) => group.label),
		['General', 'Terminal', 'Connections', 'Automation', 'Extensions', 'System'],
	);
});

test('Remote Access sits under Connections and Macros under Automation', () => {
	const groups = groupSettingsCategories(all);
	const ids = (label: string) =>
		groups.find((group) => group.label === label)?.categories.map((category) => category.id);
	assert.deepEqual(ids('Connections'), ['remote']);
	assert.deepEqual(ids('Automation'), ['macros', 'recording']);
	assert.deepEqual(ids('System'), ['updates', 'diagnostics']);
});

test('an unavailable category is omitted, and an emptied group with it', () => {
	const groups = groupSettingsCategories(all.filter((category) => category.id !== 'remote' && category.id !== 'diagnostics'));
	assert.equal(groups.some((group) => group.label === 'Connections'), false);
	assert.deepEqual(
		groups.find((group) => group.label === 'System')?.categories.map((category) => category.id),
		['updates'],
	);
});

test('a collection category carries its item count', () => {
	const groups = groupSettingsCategories(all, { macros: 7, remote: 2 });
	const automation = groups.find((group) => group.label === 'Automation');
	assert.equal(automation?.categories[0]?.count, 7);
	assert.equal(automation?.categories[1]?.count, undefined);
});

test('a category no group names is still shown, under System', () => {
	const groups = groupSettingsCategories([...all, { id: 'new-thing', label: 'New' }]);
	assert.equal(groups.at(-1)?.categories.at(-1)?.id, 'new-thing');
});
