import assert from 'node:assert/strict';
import test from 'node:test';
import {
	actionGroupKey,
	actionLinkLabel,
	actionRevealNotice,
	collapseActions,
	expandActionGroup,
	isActionGroupExpanded,
} from './botActions.ts';

const rows = (n: number) =>
	Array.from({ length: n }, (_, i) => ({ key: `row-${i}` }));

test('a short group shows every row', () => {
	assert.deepEqual(collapseActions(rows(1), false), {
		shown: rows(1),
		hidden: 0,
	});
	assert.equal(collapseActions(rows(3), false).hidden, 0);
});

test('a run of six shows the latest three and hides three until expanded', () => {
	const six = rows(6);
	const collapsed = collapseActions(six, false);
	assert.deepEqual(
		collapsed.shown.map((r) => r.key),
		['row-3', 'row-4', 'row-5'],
	);
	assert.equal(collapsed.hidden, 3);
	assert.deepEqual(collapseActions(six, true), { shown: six, hidden: 0 });
});

test('a group key stays the same as rows arrive, so expansion is kept', () => {
	const key = actionGroupKey(rows(4));
	assert.equal(actionGroupKey(rows(7)), key);
	assert.equal(isActionGroupExpanded('bot-a', key), false);
	expandActionGroup('bot-a', key);
	assert.equal(isActionGroupExpanded('bot-a', key), true);
	assert.equal(isActionGroupExpanded('bot-b', key), false);
});

test('links and notices name the target kind', () => {
	assert.equal(
		actionLinkLabel({ kind: 'terminal', projectId: 'p', sessionId: 's' }),
		'Open terminal',
	);
	assert.equal(
		actionLinkLabel({ kind: 'trigger', triggerId: 't' }),
		'Open triggers',
	);
	assert.equal(
		actionRevealNotice({ kind: 'project', projectId: 'p' }, 'missing'),
		'This project no longer exists',
	);
	assert.equal(
		actionRevealNotice({ kind: 'settings' }, 'elsewhere'),
		'Not available from this window',
	);
	assert.equal(
		actionRevealNotice({ kind: 'project', projectId: 'p' }, 'shown'),
		undefined,
	);
});
