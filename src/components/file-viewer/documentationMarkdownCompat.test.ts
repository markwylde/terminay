import assert from 'node:assert/strict';
import test from 'node:test';
import { selfCloseVoidHtmlElements } from './documentationMarkdownCompat.ts';

test('self-closes HTML void elements so MDX parsing accepts them', () => {
	assert.equal(
		selfCloseVoidHtmlElements('<img src="a.svg" alt="A" width="720">'),
		'<img src="a.svg" alt="A" width="720" />',
	);
	assert.equal(selfCloseVoidHtmlElements('a<br>b<BR >c'), 'a<br />b<BR />c');
});

test('leaves closed tags, lookalike names, and code untouched', () => {
	const untouched = [
		'<img src="a.svg" />',
		'<br/>',
		'<brand>',
		'`<img src="a.svg">`',
		'```html\n<img src="a.svg">\n```',
		'~~~~\n<br>\n~~~\n<hr>\n~~~~',
	];
	for (const markdown of untouched)
		assert.equal(selfCloseVoidHtmlElements(markdown), markdown);
});

test('resumes after a closed fence', () => {
	assert.equal(
		selfCloseVoidHtmlElements('```\n<br>\n```\n<br>'),
		'```\n<br>\n```\n<br />',
	);
});
