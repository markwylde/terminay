import assert from 'node:assert/strict';
import test from 'node:test';

import {
	terminalTitleDraft,
	terminalTitleSubmission,
} from './terminalTitleEdit.ts';

test('a tab showing its program title has an empty name field with that title as placeholder', () => {
	assert.deepEqual(
		terminalTitleDraft(
			{ defaultTitle: 'Terminal 1', programTitle: 'claude' },
			'claude',
		),
		{ title: '', automaticTitle: 'claude' },
	);
});

test('a tab with only its default name offers that as the placeholder', () => {
	assert.deepEqual(
		terminalTitleDraft({ defaultTitle: 'Terminal 2' }, 'Terminal 2'),
		{ title: '', automaticTitle: 'Terminal 2' },
	);
});

test('a renamed tab edits its name, and the placeholder is what clearing it would show', () => {
	assert.deepEqual(
		terminalTitleDraft(
			{ defaultTitle: 'Terminal 1', namedTitle: 'api', programTitle: 'claude' },
			'api',
		),
		{ title: 'api', automaticTitle: 'claude' },
	);
});

test('entering a name sends and shows that name', () => {
	const draft = terminalTitleDraft(
		{ defaultTitle: 'Terminal 1', programTitle: 'claude' },
		'claude',
	);
	assert.deepEqual(terminalTitleSubmission(draft, '  api  ', 'claude'), {
		patchTitle: 'api',
		shownTitle: 'api',
	});
});

test('clearing the name sends an empty title and shows the automatic one', () => {
	const draft = terminalTitleDraft(
		{ defaultTitle: 'Terminal 1', namedTitle: 'api', programTitle: 'claude' },
		'api',
	);
	assert.deepEqual(terminalTitleSubmission(draft, '   ', 'api'), {
		patchTitle: '',
		shownTitle: 'claude',
	});
	const plain = terminalTitleDraft(
		{ defaultTitle: 'Terminal 3', namedTitle: 'api' },
		'api',
	);
	assert.deepEqual(terminalTitleSubmission(plain, '', 'api'), {
		patchTitle: '',
		shownTitle: 'Terminal 3',
	});
});

test('a server that does not publish title sources keeps the shown title as the name', () => {
	for (const sources of [undefined, {}]) {
		const draft = terminalTitleDraft(sources, 'Terminal 1');
		assert.deepEqual(draft, { title: 'Terminal 1' });
		// An empty name cannot be told apart from "no change" there.
		assert.deepEqual(terminalTitleSubmission(draft, '', 'Terminal 1'), {
			patchTitle: 'Terminal 1',
			shownTitle: 'Terminal 1',
		});
	}
});
