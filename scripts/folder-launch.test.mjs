import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const out = await mkdtemp(join(tmpdir(), 'terminay-folder-launch-'));
await build({
	entryPoints: ['electron/folderLaunch.ts'],
	bundle: true,
	platform: 'node',
	format: 'esm',
	outfile: join(out, 'launch.mjs'),
});
const {
	parseFolderLaunch,
	folderLaunchOperands,
	folderLaunchRelaunchArgs,
	forwardedFolderLaunch,
	FolderLaunchQueue,
} = await import(pathToFileURL(join(out, 'launch.mjs')).href);
test.after(() => rm(out, { recursive: true, force: true }));

test('paths remain literal and ordered across mixed and repeated options', () => {
	assert.deepEqual(
		parseFolderLaunch(
			[
				'--working-directory',
				'a b',
				'ü $(touch nope)',
				'--working-directory=c',
				'--',
				'-folder',
			],
			'/work',
		),
		['/work/a b', '/work/ü $(touch nope)', '/work/c', '/work/-folder'],
	);
	assert.deepEqual(
		parseFolderLaunch(['file:///tmp/a%20b', 'file://localhost/tmp/c'], '/work'),
		['/tmp/a b', '/tmp/c'],
	);
});
test('syntax errors reject the invocation before submission', () => {
	for (const args of [
		['A', '--unknown', 'B'],
		['--working-directory'],
		['--working-directory='],
		['file://other/tmp/a'],
		['https://example.com'],
		['file:///tmp/a?b'],
		['file:///tmp/%zz'],
		['\0'],
		['a'.repeat(4097)],
	])
		assert.throws(() => parseFolderLaunch(args, '/work'));
});
test('runtime args, executable and development entry are not folders', () => {
	assert.deepEqual(
		parseFolderLaunch(
			[
				'-psn_0_123',
				'--no-sandbox',
				'--updated',
				'--headless',
				'--use-mock-keychain',
				'--original-process-start-time=123',
				'/tmp',
			],
			'/work',
		),
		['/tmp'],
	);
	assert.deepEqual(folderLaunchOperands(['/app', 'folder'], true), ['folder']);
	assert.deepEqual(
		folderLaunchOperands(['/electron', 'entry', 'folder'], false),
		['folder'],
	);
	assert.deepEqual(folderLaunchRelaunchArgs(['/app', 'folder'], true), []);
	assert.deepEqual(
		folderLaunchRelaunchArgs(['/electron', 'entry', 'folder'], false),
		['entry'],
	);
});
test('forwarded data preserves invocation directory and rejects malformed shapes', () => {
	assert.deepEqual(
		forwardedFolderLaunch({
			kind: 'terminay-folder-launch',
			cwd: '/other',
			args: ['project'],
		}),
		{ cwd: '/other', args: ['project'] },
	);
	assert.equal(
		forwardedFolderLaunch({
			kind: 'terminay-folder-launch',
			cwd: 'relative',
			args: [],
		}),
		undefined,
	);
});
test('queue waits for ready, preserves repeated requests, and continues after failure', async () => {
	const errors = [],
		seen = [];
	const queue = new FolderLaunchQueue((e) => errors.push(e));
	queue.submit(['a', 'bad', 'a']);
	assert.deepEqual(seen, []);
	queue.ready(async (p) => {
		seen.push(p);
		if (p === 'bad') throw Error('missing');
	});
	await new Promise((r) => setImmediate(r));
	assert.deepEqual(seen, ['a', 'bad', 'a']);
	assert.equal(errors.length, 1);
});
test('overflow is atomic and bootstrap failure rejects pending requests', async () => {
	const errors = [],
		seen = [];
	const queue = new FolderLaunchQueue((e) => errors.push(e));
	queue.submit(Array(64).fill('a'));
	queue.submit(['b']);
	queue.ready(async (p) => {
		seen.push(p);
	});
	await new Promise((r) => setImmediate(r));
	assert.equal(seen.length, 64);
	assert.equal(errors.length, 1);
	const failed = new FolderLaunchQueue((e) => errors.push(e));
	failed.submit(['a']);
	failed.fail(Error('bootstrap'));
	failed.ready(async (p) => seen.push(p));
	await new Promise((r) => setImmediate(r));
	assert.equal(seen.length, 64);
	assert.equal(errors.length, 2);
});

test('macOS declares only alternate folder handling and no renderer launch route', async () => {
	const { readFile } = await import('node:fs/promises');
	const { default: JSON5 } = await import('json5');
	const config = JSON5.parse(await readFile('electron-builder.json5', 'utf8'));
	assert.deepEqual(config.mac.extendInfo.CFBundleDocumentTypes, [
		{
			CFBundleTypeName: 'Folder',
			CFBundleTypeRole: 'Editor',
			LSHandlerRank: 'Alternate',
			LSItemContentTypes: ['public.folder', 'public.directory'],
		},
	]);
	for (const file of ['electron/serverUiPreload.ts']) {
		const text = await readFile(file, 'utf8');
		assert.doesNotMatch(
			text,
			/openNativeFolder|presentNativeFolder|native-folder-launch/,
		);
	}
});
