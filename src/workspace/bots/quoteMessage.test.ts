import assert from 'node:assert/strict';
import test from 'node:test';
import { appendQuote, QUOTE_LIMIT, quoteMessage } from './quoteMessage.ts';

test('nothing to quote', () => {
	assert.equal(quoteMessage(''), '');
	assert.equal(quoteMessage('  \n\t\n '), '');
});

test('single line', () => {
	assert.equal(quoteMessage('Ship it'), '> Ship it\n\n');
});

test('multi-line with blank lines, CRLF and CR', () => {
	assert.equal(
		quoteMessage('Build passed.\r\n\r\nDeployed to staging.\n'),
		'> Build passed.\n>\n> Deployed to staging.\n\n',
	);
	assert.equal(quoteMessage('a\rb'), '> a\n> b\n\n');
});

test('leading and trailing blank lines go, trailing spaces on a line stay', () => {
	assert.equal(
		quoteMessage('\n  \nhard  \nbreak\n\n'),
		'> hard  \n> break\n\n',
	);
});

test('nested quotes, fences and lists keep their Markdown', () => {
	assert.equal(quoteMessage('> earlier'), '> > earlier\n\n');
	assert.equal(
		quoteMessage('- one\n- two\n\n```ts\nconst x = 1;\n```'),
		'> - one\n> - two\n>\n> ```ts\n> const x = 1;\n> ```\n\n',
	);
});

test('exactly the limit is not cut', () => {
	const text = 'a'.repeat(QUOTE_LIMIT);
	assert.equal(quoteMessage(text), `> ${text}\n\n`);
});

test('a long message is cut at a line break in the second half', () => {
	const line = 'x'.repeat(79);
	const text = Array.from({ length: 125 }, () => line).join('\n');
	const quote = quoteMessage(text);
	assert.ok(quote.endsWith('>\n> …\n\n'));
	const body = quote.split('\n').filter((l) => l.startsWith('> x'));
	// 25 whole 80-code-point lines fit in 2,000; the 26th would not.
	assert.equal(body.length, 25);
	assert.ok(body.every((l) => l === `> ${line}`));
});

test('a long line with no break in the second half is cut hard', () => {
	const text = `short\n${'y'.repeat(5000)}`;
	const quote = quoteMessage(text);
	const kept = quote.split('\n').slice(0, 2).join('\n');
	assert.equal(kept, `> short\n> ${'y'.repeat(QUOTE_LIMIT - 6)}`);
	assert.ok(quote.endsWith('>\n> …\n\n'));
});

test('the cut never splits a code point', () => {
	const text = '😀'.repeat(QUOTE_LIMIT + 10);
	const quote = quoteMessage(text);
	const first = quote.split('\n')[0]!.slice(2);
	assert.equal(Array.from(first).length, QUOTE_LIMIT);
	assert.ok(Array.from(first).every((c) => c === '😀'));
});

test('a fence cut open is closed before the ellipsis', () => {
	const code = Array.from(
		{ length: 60 },
		(_, i) => `line ${i} ${'z'.repeat(40)}`,
	);
	const text = ['Here:', '', '~~~~js', ...code, '~~~~', 'after'].join('\n');
	const quote = quoteMessage(text);
	assert.ok(quote.endsWith('> ~~~~\n>\n> …\n\n'), quote.slice(-60));
	assert.ok(!quote.includes('after'));
});

test('a fence line with an info string does not close an open fence', () => {
	const code = Array.from({ length: 60 }, () => 'q'.repeat(50));
	const text = ['```sh', '```not-a-close', ...code, '```'].join('\n');
	const quote = quoteMessage(text);
	assert.ok(quote.endsWith('> ```\n>\n> …\n\n'), quote.slice(-40));
});

test('a fence inside a list is closed at its own indentation', () => {
	const code = Array.from({ length: 60 }, () => `   ${'r'.repeat(50)}`);
	const text = ['1. Run:', '   ```sh', ...code, '   ```'].join('\n');
	const quote = quoteMessage(text);
	assert.ok(quote.endsWith('>    ```\n>\n> …\n\n'), quote.slice(-40));
});

test('a closed fence before the cut is not closed again', () => {
	const prose = Array.from({ length: 60 }, () => 'w'.repeat(60));
	const text = ['```', 'code', '```', ...prose].join('\n');
	const quote = quoteMessage(text);
	assert.equal(quote.split('\n').filter((l) => l === '> ```').length, 2);
});

test('appending never changes the draft', () => {
	assert.equal(appendQuote('', '> A\n\n'), '> A\n\n');
	assert.equal(appendQuote('About this:', '> A\n\n'), 'About this:\n\n> A\n\n');
	assert.equal(
		appendQuote('Two things:\n', '> A\n\n'),
		'Two things:\n\n> A\n\n',
	);
	assert.equal(appendQuote('Done\n\n', '> A\n\n'), 'Done\n\n> A\n\n');
	assert.equal(appendQuote('  ', '> A\n\n'), '  \n\n> A\n\n');
	assert.equal(appendQuote('ends  ', '> A\n\n'), 'ends  \n\n> A\n\n');
});

test('two quotes in a row', () => {
	assert.equal(
		appendQuote(appendQuote('', quoteMessage('A')), quoteMessage('B')),
		'> A\n\n> B\n\n',
	);
});
