// Run after the application/workspace build. Test discovery imports their dist/
// modules, but --list never starts Electron or the browser fixtures.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { listedTests, timingKey, sharesSetup, shardTestLists } from './support/e2e-shard-test-list.mjs';

test('actual Playwright identities are covered once and accepted by its test-list selector', { timeout: 115_000 }, async () => {
	const run = promisify(execFile);
	const list = async (args = []) => {
		const { stdout } = await run(process.execPath, ['node_modules/playwright/cli.js', 'test', '--list', '--reporter=json', ...args], {
			timeout: 50_000, maxBuffer: 64 * 1024 * 1024,
		});
		return JSON.parse(stdout.slice(stdout.indexOf('{')));
	};
	const listing = await list();
	const sources = new Map();
	const keepsTogether = (file) => sources.get(file);
	for (const test of listedTests(listing)) {
		if (!sources.has(test.file)) sources.set(test.file, sharesSetup(await readFile(join(listing.config.rootDir, test.file), 'utf8')));
	}
	const snapshot = JSON.parse(await readFile(new URL('./support/e2e-duration-snapshot.json', import.meta.url), 'utf8'));
	const lists = shardTestLists(listing, keepsTogether, 18, snapshot.durations);
	assert.equal(lists.length, 18);
	assert.ok(lists.every((lines) => lines.length));
	const directory = await mkdtemp(join(tmpdir(), 'terminay-shard-selection-'));
	try {
		const path = join(directory, 'tests.txt');
		await writeFile(path, lists.flat().join('\n'));
		const selected = await list([`--test-list=${path}`]);
		assert.deepEqual(listedTests(selected).map(timingKey).sort(), listedTests(listing).map(timingKey).sort());
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
