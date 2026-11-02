import assert from 'node:assert/strict';
import test from 'node:test';

import {
	terminalTitleDraft,
	terminalTitleSubmission,
} from './terminalTitleEdit.ts';

test('a tab showing its program title has an empty name field with that title as placeholder', () => {
	assert.deepEqual(
		terminalTitleDraft({ defaultTitle: 'Terminal 1' }, 'claude'),
		{ title: '', automaticTitle: 'claude' },
	);
});

test('a tab with only its default name offers that as the placeholder', () => {
	assert.deepEqual(
		terminalTitleDraft({ defaultTitle: 'Terminal 2' }, 'Terminal 2'),
		{ title: '', automaticTitle: 'Terminal 2' },
	);
});

test('a renamed tab edits its name, and the placeholder is its default name', () => {
	// Under a name the program's title is not shown, and a client is told
	// only what a terminal displays, so the default name stands in.
	assert.deepEqual(
		terminalTitleDraft(
			{ defaultTitle: 'Terminal 1', namedTitle: 'api' },
			'api',
		),
		{ title: 'api', automaticTitle: 'Terminal 1' },
	);
});

test('entering a name lets the server publish the displayed title', () => {
	const draft = terminalTitleDraft({ defaultTitle: 'Terminal 1' }, 'claude');
	assert.deepEqual(terminalTitleSubmission(draft, '  api  ', 'claude'), {
		patchTitle: 'api',
	});
});

test('clearing the name sends an empty title without a stale display fallback', () => {
	const plain = terminalTitleDraft(
		{ defaultTitle: 'Terminal 3', namedTitle: 'api' },
		'api',
	);
	assert.deepEqual(terminalTitleSubmission(plain, '', 'api'), {
		patchTitle: '',
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
		assert.deepEqual(terminalTitleSubmission(draft, ' api ', 'Terminal 1'), {
			patchTitle: 'api',
			shownTitle: 'api',
		});
	}
});

test('clearing a name preserves the server title whether its event arrives before or after the save reply', async () => {
	for (const eventFirst of [true, false]) {
		const draft = terminalTitleDraft(
			{ defaultTitle: 'Terminal 1', namedTitle: 'api' },
			'api',
		);
		const submission = terminalTitleSubmission(draft, '', 'api');
		let displayed = 'api';
		let reply!: () => void;
		const response = new Promise<void>((resolve) => {
			reply = resolve;
		});
		const saving = response.then(() => {
			if (submission.shownTitle !== undefined)
				displayed = submission.shownTitle;
		});
		if (eventFirst) displayed = 'deploy';
		reply();
		await saving;
		if (!eventFirst) displayed = 'deploy';
		assert.equal(
			displayed,
			'deploy',
			`title event ${eventFirst ? 'before' : 'after'} save reply`,
		);
	}
});
