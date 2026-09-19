import assert from 'node:assert/strict';
import test from 'node:test';
import {
	documentationImageType,
	resolveDocumentationImagePath,
} from './documentationImages.ts';

const doc = 'docs/guide/README.md';

test('relative image sources resolve against the document folder', () => {
	assert.equal(resolveDocumentationImagePath('a.svg', doc), 'docs/guide/a.svg');
	assert.equal(
		resolveDocumentationImagePath('./images/a%20b.png?raw=1#x', doc),
		'docs/guide/images/a b.png',
	);
	assert.equal(
		resolveDocumentationImagePath('../../logo.png', doc),
		'logo.png',
	);
	assert.equal(
		resolveDocumentationImagePath('docs/images/c.svg', 'README.md'),
		'docs/images/c.svg',
	);
});

test('root-relative sources resolve against the project root', () => {
	assert.equal(
		resolveDocumentationImagePath('/docs/images/c.svg', doc),
		'docs/images/c.svg',
	);
});

test('URLs, and paths that leave the project, are left alone', () => {
	for (const src of [
		'https://x.test/a.png',
		'//cdn.test/a.png',
		'data:image/png;base64,AA',
		'blob:abc',
		'',
		'../../../outside.png',
	])
		assert.equal(resolveDocumentationImagePath(src, doc), undefined);
});

test('SVG gets an image type an <img> will render', () => {
	assert.equal(documentationImageType('/r/a.SVG', 'text/xml'), 'image/svg+xml');
	assert.equal(
		documentationImageType('/r/a.unknown', 'image/tiff'),
		'image/tiff',
	);
	assert.equal(
		documentationImageType('/r/a', null),
		'application/octet-stream',
	);
});
