import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
	DEFAULT_IGNORED_DIRECTORIES,
	isHiddenDirectoryName,
	isIgnoredDirectoryName,
	isIgnoredPath,
	matchesIgnorePattern,
	shouldSkipDocumentationDirectory,
	validIgnorePattern,
} from '../dist/index.js';

test('default ignore rules cover VCS, hidden tooling, dependencies, and generated output', () => {
	assert.deepEqual([...DEFAULT_IGNORED_DIRECTORIES], [
		'.git',
		'.hg',
		'.svn',
		'.next',
		'.turbo',
		'.vite',
		'coverage',
		'dist',
		'dist-electron',
		'node_modules',
		'release',
	]);
	for (const name of DEFAULT_IGNORED_DIRECTORIES)
		assert.equal(isIgnoredDirectoryName(name), true);
	assert.equal(isIgnoredDirectoryName('docs'), false);
	assert.equal(isIgnoredDirectoryName('src'), false);
	assert.equal(isIgnoredPath('docs/node_modules/pkg/README.md'), true);
	assert.equal(isIgnoredPath('docs/guide.md'), false);
	assert.equal(isHiddenDirectoryName('.cache'), true);
	assert.equal(isHiddenDirectoryName('docs'), false);
	assert.equal(shouldSkipDocumentationDirectory('.hidden'), true);
	assert.equal(shouldSkipDocumentationDirectory('node_modules'), true);
	assert.equal(shouldSkipDocumentationDirectory('docs'), false);
	assert.equal(matchesIgnorePattern('dist*', 'dist-electron'), true);
	assert.equal(validIgnorePattern('build'), 'build');
	assert.throws(() => validIgnorePattern('foo/bar'));
});

test('configured ignore patterns are applied without copying default string lists', async () => {
	assert.equal(isIgnoredDirectoryName('vendor', ['vendor', 'tmp']), true);
	assert.equal(isIgnoredDirectoryName('docs', ['vendor']), false);
	const root = fileURLToPath(new URL('../src/fileService', import.meta.url));
	const names = await readdir(root);
	const hits = [];
	for (const name of names) {
		if (!name.endsWith('.ts')) continue;
		const source = await readFile(path.join(root, name), 'utf8');
		if (source.includes('DEFAULT_IGNORED_DIRECTORIES = Object.freeze(['))
			hits.push(name);
	}
	assert.deepEqual(hits, ['ignore.ts']);
});

