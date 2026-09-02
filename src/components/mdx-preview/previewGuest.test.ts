import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPreviewNavigation, previewGuestDocument } from './previewGuest.ts';

test('3.7 project assets stay opaque while http(s) stay ordinary URLs', () => {
	assert.deepEqual(classifyPreviewNavigation('https://cdn.example/font.woff2'), {
		kind: 'external',
		url: 'https://cdn.example/font.woff2',
	});
	assert.deepEqual(classifyPreviewNavigation('http://example.com/img.png'), {
		kind: 'external',
		url: 'http://example.com/img.png',
	});
	assert.equal(classifyPreviewNavigation('file:///etc/passwd').kind, 'blocked');
	assert.equal(classifyPreviewNavigation('docs/logo.png').kind, 'blocked');
});

test('3.8 intercepts navigation and native forms while keeping fragments', () => {
	assert.deepEqual(classifyPreviewNavigation('#intro'), { kind: 'fragment', hash: '#intro' });
	assert.equal(classifyPreviewNavigation('javascript:alert(1)').kind, 'blocked');
	const html = previewGuestDocument('runtime-1', 'blob:guest', { entries: {}, cookie: '' });
	assert.match(html, /addEventListener\('submit'/u);
	assert.match(html, /event.preventDefault/u);
	assert.match(html, /href.startsWith\('#'\)/u);
});

test('3.9 blocks popups and routes documents versus external links', () => {
	const html = previewGuestDocument('runtime-1', 'blob:guest', { entries: {}, cookie: '' });
	assert.match(html, /window.open=function\(\)\{return null\}/u);
	assert.match(html, /permissions.query=async\(\)=>\(\{state:'denied'/u);
	assert.deepEqual(classifyPreviewNavigation('guide.mdx'), { kind: 'document', path: 'guide.mdx' });
	assert.deepEqual(classifyPreviewNavigation('https://example.com'), {
		kind: 'external',
		url: 'https://example.com',
	});
	assert.equal(classifyPreviewNavigation('../secret.mdx').kind, 'blocked');
});
