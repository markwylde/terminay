import assert from 'node:assert/strict';
import test from 'node:test';
import { directiveFromMarkdown } from 'mdast-util-directive';
import { directive } from 'micromark-extension-directive';
import {
	createDocumentationEditorChanges,
	sameMarkdownDocument,
} from './documentationEditorChanges.ts';

const sameDocument = (left: string, right: string) =>
	sameMarkdownDocument(left, right, {
		extensions: [directive()],
		mdastExtensions: [directiveFromMarkdown()],
	});

const opened = '# Hello\n\n:::info\n:::';
// What MDXEditor reports for `opened` when the views change and the empty
// admonition's nested editor writes its blank paragraph back.
const respelled = '# Hello\n\n:::info\n\n:::';

/** A change of views, as the view toggle's click makes one. */
function changeViews(
	changes: ReturnType<typeof createDocumentationEditorChanges>,
	reports: readonly string[],
): (string | undefined)[] {
	changes.viewChangeStarted();
	try {
		return reports.map((report) => changes.reported(report, false));
	} finally {
		changes.viewChangeEnded();
	}
}

test('an edit made straight after a change of views is saved', () => {
	const changes = createDocumentationEditorChanges(opened, sameDocument);
	assert.deepEqual(changeViews(changes, [respelled]), [undefined]);
	// Nothing else happens between the switch and the keystroke: no time
	// passes, and the edit is still an edit.
	assert.equal(
		changes.reported('# Hello typed\n\n:::info\n\n:::', false),
		'# Hello typed\n\n:::info\n\n:::',
	);
});

test('a change of views that only respells the document is not an edit', () => {
	const changes = createDocumentationEditorChanges(opened, sameDocument);
	assert.deepEqual(changeViews(changes, [respelled]), [undefined]);
	// The editor keeps the respelling, so the source view reporting the same
	// text later is quiet too.
	assert.equal(changes.current(), respelled);
	assert.equal(changes.reported(respelled, false), undefined);
});

test('words a change of views writes back from a nested editor are an edit', () => {
	// An admonition's body reaches the document only when its editor loses
	// focus or the views change, so the change of views can carry typing.
	const changes = createDocumentationEditorChanges(opened, sameDocument);
	assert.deepEqual(changeViews(changes, ['# Hello\n\n:::info\nnoted\n:::']), [
		'# Hello\n\n:::info\nnoted\n:::',
	]);
});

test('a respelling outside a change of views is an edit', () => {
	const changes = createDocumentationEditorChanges(opened, sameDocument);
	assert.equal(changes.reported(respelled, false), respelled);
});

test('the normalization reported on opening is not an edit', () => {
	const changes = createDocumentationEditorChanges(
		'A wrapped\nparagraph.',
		sameDocument,
	);
	assert.equal(changes.reported('A wrapped paragraph.', true), undefined);
	assert.equal(changes.current(), 'A wrapped paragraph.');
});

test('a document loaded into the editor is not reported back as an edit', () => {
	const changes = createDocumentationEditorChanges(opened, sameDocument);
	changes.loaded('# From disk');
	assert.equal(changes.reported('# From disk', false), undefined);
});

test('a change of views whose documents cannot be compared is saved', () => {
	const changes = createDocumentationEditorChanges(opened, () => {
		throw new Error('unreadable');
	});
	assert.deepEqual(changeViews(changes, [respelled]), [respelled]);
});

test('documents are compared by structure, not by spelling', () => {
	assert.equal(sameDocument(opened, respelled), true);
	assert.equal(sameDocument('* a\n* b', '- a\n- b'), true);
	assert.equal(sameDocument('# Hello', '# Hello there'), false);
	assert.equal(sameDocument(':::info\n:::', ':::note\n:::'), false);
});
