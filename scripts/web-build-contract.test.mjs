import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const managerEntry = await readFile(path.join(root, 'web.html'), 'utf8');
const desktopEntry = await readFile(path.join(root, 'index.html'), 'utf8');
const config = await readFile(path.join(root, 'vite.web.config.ts'), 'utf8');
const managerOutput = await readFile(
	path.join(root, 'dist-web', 'web.html'),
	'utf8',
);

test('hosted web build uses the dedicated shared-web manager entry', () => {
	assert.match(managerEntry, /id="web-root"/u);
	assert.match(managerEntry, /src="\/src\/web\/main\.tsx"/u);
	assert.match(managerEntry, /<title>Terminay Connections<\/title>/u);
	assert.match(desktopEntry, /id="root"/u);
	assert.match(desktopEntry, /src="\/src\/main\.tsx"/u);
	assert.doesNotMatch(desktopEntry, /src="\/src\/web\/main\.tsx"/u);
});

test('hosted web build is standalone and excludes the retired terminal-only remote document', async () => {
	assert.match(config, /web: path\.resolve\(__dirname, 'web\.html'\)/u);
	assert.doesNotMatch(config, /remote\.html/u);
	assert.match(config, /outDir:[\s\S]*dist-web/u);
	assert.match(config, /plugins:\s*\[react\(\)\]/u);
	assert.doesNotMatch(config, /vite-plugin-electron/u);
	await access(path.join(root, 'dist-web', 'web.html'));
	await assert.rejects(access(path.join(root, 'dist-web', 'remote.html')));
	assert.match(managerOutput, /<title>Terminay Connections<\/title>/u);
	assert.match(managerOutput, /<script type="module"[^>]+src="\/assets\//u);
	assert.doesNotMatch(managerOutput, /src\/web\/main\.tsx/u);
});
