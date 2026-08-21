import assert from 'node:assert/strict';
import test from 'node:test';
import { CanonicalProjectPathResolver, DocumentationCatalog } from '../dist/index.js';

function fixture() {
	const text = new TextEncoder();
	const content = new Map([
		['/project/README.md', '# Read me'],
		['/project/docs/guide.mdx', '---\ntitle: Getting Started\n---\n# Guide'],
		['/project/docs/APIReference.md', '# API'],
		['/project/node_modules/ignored.md', '# ignored'],
	]);
	const files = new Map([['/project', { isDirectory: true }], ['/project/docs', { isDirectory: true }], ['/project/node_modules', { isDirectory: true }], ...[...content].map(([path, value]) => [path, { isFile: true, size: text.encode(value).byteLength }])]);
	const directories = new Map([['/project', [{ name: 'README.md', isFile: true }, { name: 'docs', isDirectory: true }, { name: 'node_modules', isDirectory: true }]], ['/project/docs', [{ name: 'guide.mdx', isFile: true }, { name: 'APIReference.md', isFile: true }]], ['/project/node_modules', [{ name: 'ignored.md', isFile: true }]]]);
	const missing = (path) => Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' });
	const storage = {
		realpath(path) { if (!files.has(path)) throw missing(path); return path; },
		stat(path) { const item = files.get(path); if (!item) throw missing(path); return item; },
		lstat(path) { if (!files.has(path)) throw missing(path); return { isSymbolicLink: false }; },
		readDirectory(path) { const entries = directories.get(path); if (!entries) throw missing(path); return entries; },
		readRange(path, offset, length) { return text.encode(content.get(path) ?? '').slice(offset, offset + length); },
	};
	return new DocumentationCatalog(new CanonicalProjectPathResolver('/project', storage), storage);
}

test('DocumentationCatalog recursively discovers MD/MDX, prunes ignored folders, and uses frontmatter titles', async () => {
	const result = await fixture().catalog();
	assert.deepEqual(result.folders.map((folder) => folder.relativePath), ['docs']);
	assert.deepEqual(result.folders.map((folder) => folder.title), ['Docs']);
	assert.deepEqual(result.documents.map((document) => [document.relativePath, document.title, document.titleSource]), [
		['docs/APIReference.md', 'Api Reference', 'filename'],
		['docs/guide.mdx', 'Getting Started', 'frontmatter'],
		['README.md', 'Readme', 'filename'],
	]);
});
