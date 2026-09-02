import assert from 'node:assert/strict';
import test from 'node:test';
import {
	CanonicalProjectPathResolver,
	DocumentationCatalog,
	frontmatterTitle,
	titleCase,
} from '../dist/index.js';

function memoryProject(spec) {
	const text = new TextEncoder();
	const files = new Map(spec.files ?? []);
	const directories = new Map(spec.directories ?? []);
	const links = new Set(spec.symlinks ?? []);
	const missing = (path) => Object.assign(new Error(`ENOENT ${path}`), { code: 'ENOENT' });
	const storage = {
		realpath(path) {
			if (spec.realpath) return spec.realpath(path);
			if (!files.has(path) && !directories.has(path)) throw missing(path);
			return path;
		},
		stat(path) {
			if (directories.has(path)) return { isDirectory: true };
			const item = files.get(path);
			if (item === undefined) throw missing(path);
			const bytes = typeof item === 'string' ? text.encode(item) : item;
			return { isFile: true, size: bytes.byteLength };
		},
		lstat(path) {
			if (links.has(path)) return { isSymbolicLink: true };
			if (!files.has(path) && !directories.has(path)) throw missing(path);
			return { isSymbolicLink: false };
		},
		readDirectory(path) {
			const entries = directories.get(path);
			if (!entries) throw missing(path);
			return entries;
		},
		readRange(path, offset, length) {
			const item = files.get(path);
			if (item === undefined) throw missing(path);
			const bytes = typeof item === 'string' ? text.encode(item) : item;
			return bytes.slice(offset, offset + length);
		},
	};
	return {
		storage,
		catalog: new DocumentationCatalog(
			new CanonicalProjectPathResolver('/project', storage),
			storage,
			spec.options ?? {},
		),
	};
}

function fixture() {
	return memoryProject({
		files: [
			['/project/README.md', '# Read me'],
			['/project/docs/guide.mdx', '---\ntitle: Getting Started\n---\n# Guide'],
			['/project/docs/APIReference.md', '# API'],
			['/project/docs/empty/nope.txt', 'skip'],
			['/project/node_modules/ignored.md', '# ignored'],
			['/project/.hidden/secret.md', '# secret'],
		],
		directories: [
			[
				'/project',
				[
					{ name: 'README.md', isFile: true },
					{ name: 'docs', isDirectory: true },
					{ name: 'node_modules', isDirectory: true },
					{ name: '.hidden', isDirectory: true },
				],
			],
			[
				'/project/docs',
				[
					{ name: 'guide.mdx', isFile: true },
					{ name: 'APIReference.md', isFile: true },
					{ name: 'empty', isDirectory: true },
				],
			],
			['/project/docs/empty', [{ name: 'nope.txt', isFile: true }]],
			['/project/node_modules', [{ name: 'ignored.md', isFile: true }]],
			['/project/.hidden', [{ name: 'secret.md', isFile: true }]],
		],
	});
}

test('DocumentationCatalog recursively discovers MD/MDX, prunes empty and ignored folders, and uses frontmatter titles', async () => {
	const result = await fixture().catalog.catalog();
	assert.deepEqual(
		result.folders.map((folder) => folder.relativePath),
		['docs'],
	);
	assert.deepEqual(
		result.folders.map((folder) => folder.title),
		['Docs'],
	);
	assert.deepEqual(
		result.documents.map((document) => [
			document.relativePath,
			document.title,
			document.titleSource,
		]),
		[
			['docs/APIReference.md', 'Api Reference', 'filename'],
			['docs/guide.mdx', 'Getting Started', 'frontmatter'],
			['README.md', 'Readme', 'filename'],
		],
	);
	assert.equal(result.partial, false);
	assert.equal(result.observationCapability, 'unavailable');
});

test('DocumentationCatalog never follows a symlink out of the project', async () => {
	const project = memoryProject({
		files: [
			['/project/inside.md', '# inside'],
			['/outside/escape.md', '# escaped'],
		],
		directories: [
			[
				'/project',
				[
					{ name: 'inside.md', isFile: true },
					{ name: 'link', isDirectory: true, isSymbolicLink: true },
				],
			],
			['/outside', [{ name: 'escape.md', isFile: true }]],
		],
		symlinks: ['/project/link'],
		realpath(path) {
			if (path === '/project/link' || path.startsWith('/project/link/'))
				return path.replace('/project/link', '/outside');
			return path;
		},
	});
	const result = await project.catalog.catalog();
	assert.deepEqual(
		result.documents.map((document) => document.relativePath),
		['inside.md'],
	);
});

test('titleCase splits separators and common camel-case without renaming paths', () => {
	assert.equal(titleCase('AGENTS'), 'Agents');
	assert.equal(titleCase('API_reference-guide'), 'Api Reference Guide');
	assert.equal(titleCase('getStartedNow'), 'Get Started Now');
	assert.equal(titleCase('XMLParser'), 'Xml Parser');
});

test('frontmatter titles accept only a non-empty string and never rewrite source', () => {
	assert.deepEqual(frontmatterTitle('---\ntitle: Hello World\n---\n# Body', false), {
		title: 'Hello World',
	});
	assert.deepEqual(frontmatterTitle('---\nother: 1\n---\n# Body', false), {});
	assert.equal(frontmatterTitle('---\ntitle: ""\n---\n', false).diagnostic?.includes('non-empty'), true);
	assert.equal(frontmatterTitle('---\ntitle: 12\n---\n', false).diagnostic?.includes('non-empty'), true);
	assert.equal(frontmatterTitle('---\ntitle: [oops]\n---\n', false).diagnostic?.includes('non-empty'), true);
	assert.equal(frontmatterTitle('---\ntitle: Hello\n', true).diagnostic?.includes('inspection limit'), true);
	assert.equal(frontmatterTitle('---\ntitle: Hello\n', false).diagnostic?.includes('not closed'), true);
	const source = '---\ntitle: Keep Me\nextra: intact\n---\nbody';
	frontmatterTitle(source, false);
	assert.equal(source.includes('extra: intact'), true);
});

test('hostile YAML aliases and merge keys cannot create unbounded work', () => {
	const bomb = '---\na: &a ["x","x"]\nb: &b [*a,*a]\nc: &c [*b,*b]\ntitle: *c\n---\n';
	const parsed = frontmatterTitle(bomb, false);
	assert.equal(parsed.title, undefined);
	assert.equal(typeof parsed.diagnostic, 'string');
	const merge = '---\n<<: {title: Hostile}\n---\n';
	assert.equal(frontmatterTitle(merge, false).title, undefined);
});

test('folders sort before documents by display title with a relative-path tie-break', async () => {
	const result = await memoryProject({
		files: [
			['/project/zeta.md', '---\ntitle: Alpha\n---\n'],
			['/project/alpha.md', '---\ntitle: Alpha\n---\n'],
			['/project/beta/doc.md', '# Beta'],
		],
		directories: [
			[
				'/project',
				[
					{ name: 'zeta.md', isFile: true },
					{ name: 'alpha.md', isFile: true },
					{ name: 'beta', isDirectory: true },
				],
			],
			['/project/beta', [{ name: 'doc.md', isFile: true }]],
		],
	}).catalog.catalog();
	assert.deepEqual(
		result.folders.map((folder) => folder.relativePath),
		['beta'],
	);
	assert.deepEqual(
		result.documents.map((document) => document.relativePath),
		['alpha.md', 'zeta.md', 'beta/doc.md'],
	);
});

test('entry, file, depth, result, duration, and cancellation bounds mark partial results', async () => {
	const files = {
		files: [
			['/project/one.md', '# One'],
			['/project/two.md', '# Two'],
			['/project/nested/deep/three.md', '# Three'],
		],
		directories: [
			[
				'/project',
				[
					{ name: 'one.md', isFile: true },
					{ name: 'two.md', isFile: true },
					{ name: 'nested', isDirectory: true },
				],
			],
			['/project/nested', [{ name: 'deep', isDirectory: true }]],
			['/project/nested/deep', [{ name: 'three.md', isFile: true }]],
		],
	};
	const entries = await memoryProject({
		...files,
		options: { maxEntries: 1 },
	}).catalog.catalog();
	assert.equal(entries.partial, true);
	assert.equal(entries.partialReason, 'entry_limit');

	const fileLimit = await memoryProject({
		...files,
		options: { maxFiles: 1 },
	}).catalog.catalog();
	assert.equal(fileLimit.partial, true);
	assert.equal(fileLimit.partialReason, 'file_limit');
	assert.equal(typeof fileLimit.nextCursor, 'string');

	const depth = await memoryProject({
		...files,
		options: { maxDepth: 1 },
	}).catalog.catalog();
	assert.equal(depth.partial, true);
	assert.equal(depth.partialReason, 'depth_limit');

	const resultLimit = await memoryProject({
		...files,
		options: { maxResultBytes: 80 },
	}).catalog.catalog();
	assert.equal(resultLimit.partial, true);
	assert.equal(resultLimit.partialReason, 'result_limit');

	let now = 0;
	const duration = await memoryProject({
		...files,
		options: { maxDurationMs: 1, now: () => (now += 10) },
	}).catalog.catalog();
	assert.equal(duration.partial, true);
	assert.equal(duration.partialReason, 'duration_limit');

	const abort = new AbortController();
	abort.abort();
	const cancelled = await memoryProject(files).catalog.catalog(abort.signal);
	assert.equal(cancelled.partial, true);
	assert.equal(cancelled.partialReason, 'cancelled');
});

test('a catalog cursor resumes after the last returned document', async () => {
	const catalog = memoryProject({
		files: [
			['/project/a.md', '---\ntitle: A\n---\n'],
			['/project/b.md', '---\ntitle: B\n---\n'],
			['/project/c.md', '---\ntitle: C\n---\n'],
		],
		directories: [
			[
				'/project',
				[
					{ name: 'a.md', isFile: true },
					{ name: 'b.md', isFile: true },
					{ name: 'c.md', isFile: true },
				],
			],
		],
		options: { maxFiles: 1 },
	}).catalog;
	const first = await catalog.catalog();
	assert.equal(first.documents.length, 1);
	assert.equal(first.nextCursor, first.documents[0].relativePath);
	const second = await catalog.catalog({ cursor: first.nextCursor });
	assert.equal(second.documents[0].relativePath !== first.documents[0].relativePath, true);
});
