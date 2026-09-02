import assert from 'node:assert/strict';
import test from 'node:test';
import {
	documentDisplayTitle,
	documentTreeAccessibleName,
	filenameTitle,
	titleCase,
} from './documentTitle.ts';

test('title helpers keep canonical paths separate from display text', () => {
	assert.equal(titleCase('APIReference'), 'Api Reference');
	assert.equal(filenameTitle('docs/gettingStarted.mdx'), 'Getting Started');
	assert.equal(
		documentDisplayTitle('---\ntitle: Hello World\n---\n# Body', 'docs/guide.md'),
		'Hello World',
	);
	assert.equal(documentDisplayTitle('# Body', 'docs/guide.md'), 'Guide');
	assert.equal(
		documentTreeAccessibleName('Hello World', 'docs/guide.md'),
		'Hello World, docs/guide.md',
	);
	assert.equal(documentTreeAccessibleName('Guide', 'docs/guide.md'), 'Guide');
});
