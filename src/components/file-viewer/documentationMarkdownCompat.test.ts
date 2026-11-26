import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareMarkdownForMdx } from './documentationMarkdownCompat.ts';

test('self-closes HTML void elements so MDX parsing accepts them', () => {
	assert.equal(
		prepareMarkdownForMdx('<img src="a.svg" alt="A" width="720">'),
		'<img src="a.svg" alt="A" width="720" />',
	);
	assert.equal(prepareMarkdownForMdx('a<br>b<BR >c'), 'a<br />b<BR />c');
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
		assert.equal(prepareMarkdownForMdx(markdown), markdown);
});

test('resumes after a closed fence', () => {
	assert.equal(
		prepareMarkdownForMdx('```\n<br>\n```\n<br>'),
		'```\n<br>\n```\n<br />',
	);
});

test('rewrites autolinks as inline links so MDX parsing accepts them', () => {
	assert.equal(
		prepareMarkdownForMdx('Open <http://localhost:8080> and sign in:'),
		'Open [http://localhost:8080](<http://localhost:8080>) and sign in:',
	);
	assert.equal(
		prepareMarkdownForMdx('Mail <me@example.com>.'),
		'Mail [me@example.com](<mailto:me@example.com>).',
	);
	assert.equal(
		prepareMarkdownForMdx('<https://a.dev/x_y*z>'),
		'[https://a.dev/x\\_y\\*z](<https://a.dev/x_y*z>)',
	);
});

test('leaves autolink lookalikes in code and JSX tags untouched', () => {
	for (const markdown of [
		'`<http://localhost:8080>`',
		'```\n<http://localhost:8080>\n```',
		'<div>text</div>',
		'<a href="x">y</a>',
	]) {
		assert.equal(prepareMarkdownForMdx(markdown), markdown);
	}
});
