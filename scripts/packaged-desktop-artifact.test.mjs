import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(new URL('..', import.meta.url).pathname);

test('sandboxed server UI preload is a self-contained CommonJS artifact', async () => {
	const preloadPath = path.join(root, 'dist-electron', 'serverUiPreload.cjs');
	const preload = await readFile(preloadPath, 'utf8');
	assert.match(preload, /require\(["']electron["']\)/u);
	assert.doesNotMatch(preload, /(^|[;\n])\s*import\s/u);
	assert.doesNotMatch(preload, /require\(["']\.\//u);
	const syntax = spawnSync(process.execPath, ['--check', preloadPath], {
		encoding: 'utf8',
	});
	assert.equal(syntax.status, 0, syntax.stderr);
});

test('packaged file entry uses relative references to existing assets', async () => {
	const outputRoot = path.join(root, 'dist-web');
	const html = await readFile(path.join(outputRoot, 'server.html'), 'utf8');
	const references = Array.from(
		html.matchAll(/(?:src|href)="([^"]+)"/gu),
		(match) => match[1],
	);
	assert.ok(references.length > 0);
	for (const reference of references) {
		assert.match(reference, /^\.\//u);
		await access(path.join(outputRoot, reference));
	}
});
