import assert from 'node:assert/strict';
import test from 'node:test';
import { previewLinkToOpen } from './htmlPreviewLinks.ts';

const request = (url: unknown) => ({ jsonrpc: '2.0', id: 'x', method: 'ui/open-link', params: { url } });
const using = { now: 10_000, userActive: true };

test('a web link the user activated is opened', () => {
	const state = { lastOpenedAt: 0 };
	assert.equal(previewLinkToOpen(request('https://example.com/a?b=1#c'), state, using), 'https://example.com/a?b=1#c');
	assert.equal(state.lastOpenedAt, 10_000);
	assert.equal(previewLinkToOpen(request('http://example.com'), { lastOpenedAt: 0 }, using), 'http://example.com/');
});

test('a request made while nobody is using the page is refused', () => {
	const state = { lastOpenedAt: 0 };
	assert.equal(previewLinkToOpen(request('https://example.com'), state, { now: 10_000, userActive: false }), undefined);
	assert.equal(state.lastOpenedAt, 0);
});

test('only credential-free http and https links pass', () => {
	for (const url of [
		'https://user:secret@example.com/',
		'https://user@example.com/',
		'file:///etc/passwd',
		'javascript:alert(1)',
		'data:text/html,<p>x',
		'terminay://open',
		'/relative/page.html',
		'page.html',
		'',
		`https://example.com/${'a'.repeat(5000)}`,
		42,
		undefined,
	])
		assert.equal(previewLinkToOpen(request(url), { lastOpenedAt: 0 }, using), undefined, String(url).slice(0, 40));
});

test('anything that is not an open-link request is ignored', () => {
	const state = { lastOpenedAt: 0 };
	for (const message of [null, 'ui/open-link', 7, {}, { method: 'ui/message', params: { url: 'https://example.com' } }, { method: 'ui/open-link' }, { method: 'ui/open-link', params: null }])
		assert.equal(previewLinkToOpen(message, state, using), undefined);
});

test('a page cannot open one link after another', () => {
	const state = { lastOpenedAt: 0 };
	assert.equal(previewLinkToOpen(request('https://example.com/1'), state, using), 'https://example.com/1');
	assert.equal(previewLinkToOpen(request('https://example.com/2'), state, { now: 10_500, userActive: true }), undefined);
	assert.equal(previewLinkToOpen(request('https://example.com/3'), state, { now: 11_001, userActive: true }), 'https://example.com/3');
});
