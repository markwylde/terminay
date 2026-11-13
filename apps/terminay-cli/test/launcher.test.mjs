import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { installLayout } from '../dist/layout.js';
import { installLauncher, LAUNCHER_MARKER, launcherPath, removeLauncher } from '../dist/launcher.js';

async function root(t) {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-launcher-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	return directory;
}

test('a system install puts terminay in /usr/local/bin, handing off to the release CLI', async (t) => {
	const systemRoot = await root(t);
	const layout = installLayout('system', '/home/ada', systemRoot);
	const path = launcherPath(layout);
	assert.equal(path, join(systemRoot, 'usr/local/bin/terminay'));

	assert.equal(await installLauncher({ layout, write: () => {} }), true);
	const contents = await readFile(path, 'utf8');
	assert.ok(contents.startsWith('#!/bin/sh\n'));
	assert.ok(contents.includes(LAUNCHER_MARKER));
	assert.match(contents, new RegExp(`exec ${join(systemRoot, 'opt/terminay/current/bin/terminay')} "\\$@"`, 'u'));
	assert.doesNotMatch(contents, /npx|nvm/u);
	assert.equal((await stat(path)).mode & 0o777, 0o755);

	// Rewritten on the next install, since it is ours.
	assert.equal(await installLauncher({ layout, write: () => {} }), true);
	await removeLauncher(layout);
	await assert.rejects(stat(path));
});

test('a terminay file the installer did not write is never touched', async (t) => {
	const systemRoot = await root(t);
	const layout = installLayout('system', '/home/ada', systemRoot);
	const path = launcherPath(layout);
	await mkdir(join(systemRoot, 'usr/local/bin'), { recursive: true });
	await writeFile(path, '#!/bin/sh\necho someone else\n');
	const lines = [];
	assert.equal(await installLauncher({ layout, write: (line) => lines.push(line) }), false);
	assert.match(lines.join('\n'), /Left .*terminay alone/u);
	await removeLauncher(layout);
	assert.equal(await readFile(path, 'utf8'), '#!/bin/sh\necho someone else\n');
});

test('a user install uses ~/.local/bin and says when it is not on PATH', async (t) => {
	const home = await root(t);
	const layout = installLayout('user', home);
	assert.equal(launcherPath(layout), join(home, '.local/bin/terminay'));
	const lines = [];
	await installLauncher({ layout, write: (line) => lines.push(line), env: { PATH: '/usr/bin:/bin' } });
	assert.match(lines.join('\n'), /\.local\/bin is not on your PATH/u);
	lines.length = 0;
	await installLauncher({ layout, write: (line) => lines.push(line), env: { PATH: `${join(home, '.local/bin')}:/usr/bin` } });
	assert.deepEqual(lines, []);
});
