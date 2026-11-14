import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { stableInstallPath } from '../dist/stableInstallPath.js';

async function installation() {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'terminay-stable-')));
	const prefix = join(root, 'opt', 'terminay');
	for (const release of ['canary-aaa', 'canary-bbb']) {
		await mkdir(join(prefix, 'versions', release, 'bin'), { recursive: true });
		await mkdir(join(prefix, 'versions', release, 'server', 'dist'), {
			recursive: true,
		});
		await writeFile(join(prefix, 'versions', release, 'bin', 'node'), '');
		await writeFile(
			join(prefix, 'versions', release, 'server', 'dist', 'mcpEntry.js'),
			'',
		);
	}
	return { root, prefix };
}

test('a path inside the current release is named through current', async (t) => {
	const { root, prefix } = await installation();
	t.after(() => rm(root, { recursive: true, force: true }));
	await symlink('versions/canary-bbb', join(prefix, 'current'));
	assert.equal(
		stableInstallPath(join(prefix, 'versions', 'canary-bbb', 'bin', 'node')),
		join(prefix, 'current', 'bin', 'node'),
	);
	assert.equal(
		stableInstallPath(
			join(prefix, 'versions', 'canary-bbb', 'server', 'dist', 'mcpEntry.js'),
		),
		join(prefix, 'current', 'server', 'dist', 'mcpEntry.js'),
	);
	// A path reached through the link itself resolves the same way.
	assert.equal(
		stableInstallPath(join(prefix, 'current', 'bin', 'node')),
		join(prefix, 'current', 'bin', 'node'),
	);
});

test('a release that is not current keeps its own path', async (t) => {
	const { root, prefix } = await installation();
	t.after(() => rm(root, { recursive: true, force: true }));
	await symlink('versions/canary-bbb', join(prefix, 'current'));
	const path = join(prefix, 'versions', 'canary-aaa', 'bin', 'node');
	assert.equal(stableInstallPath(path), path);
});

test('no current link, or a current directory, keeps the path', async (t) => {
	const { root, prefix } = await installation();
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(prefix, 'versions', 'canary-bbb', 'bin', 'node');
	assert.equal(stableInstallPath(path), path);
	await mkdir(join(prefix, 'current'));
	assert.equal(stableInstallPath(path), path);
});

test('paths outside an installation are unchanged', async (t) => {
	const { root } = await installation();
	t.after(() => rm(root, { recursive: true, force: true }));
	const app = join(root, 'Applications', 'Terminay.app', 'Contents', 'MacOS');
	await mkdir(app, { recursive: true });
	await writeFile(join(app, 'Terminay'), '');
	assert.equal(stableInstallPath(join(app, 'Terminay')), join(app, 'Terminay'));
	const missing = join(root, 'nowhere', 'versions', 'x', 'bin', 'node');
	assert.equal(stableInstallPath(missing), missing);
	assert.equal(stableInstallPath(process.execPath), process.execPath);
});
