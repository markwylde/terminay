import assert from 'node:assert/strict';
import test from 'node:test';
import { titleCase } from '../dist/fileService/documentationCatalog.js';
import {
	CanonicalProjectPathResolver,
	DocumentationCatalog,
} from '../dist/index.js';

test('titleCase normalizes uppercase and separated filename fallbacks', () => {
	assert.equal(titleCase('AGENTS'), 'Agents');
	assert.equal(titleCase('API_reference-guide'), 'Api Reference Guide');
});

test('DocumentationCatalog keeps its revision bounded for large projects', async () => {
	const text = new TextEncoder();
	const entries = Array.from({ length: 200 }, (_, index) => ({
		name: `documentation-file-with-a-deliberately-long-name-${index.toString().padStart(3, '0')}.md`,
		isFile: true,
	}));
	const storage = {
		realpath(path) {
			return path;
		},
		stat(path) {
			return path === '/project'
				? { isDirectory: true }
				: { isFile: true, size: 7 };
		},
		lstat() {
			return { isSymbolicLink: false };
		},
		readDirectory() {
			return entries;
		},
		readRange() {
			return text.encode('# Title');
		},
	};
	const catalog = new DocumentationCatalog(
		new CanonicalProjectPathResolver('/project', storage),
		storage,
	);
	const first = await catalog.catalog();
	const second = await catalog.catalog();

	assert.equal(first.documents.length, 200);
	assert.equal(first.revision, second.revision);
	assert.match(first.revision, /^200:200:[0-9a-f]{8}$/u);
	assert.ok(first.revision.length < 64);
});
