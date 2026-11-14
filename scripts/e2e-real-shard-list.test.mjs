// Run after the application/workspace build. Discovery imports their dist/
// modules, but list mode never starts Electron or the browser fixtures.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assertExactlyOnce, nativePlaywrightAPI } from './support/verify-native-e2e-shard-lists.mjs';

test('actual Playwright identities are covered once and accepted by its test-list selector', { timeout: 115_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'terminay-shard-selection-'));
  try {
    const run = promisify(execFile);
    await run(process.execPath, [fileURLToPath(new URL('./support/verify-native-e2e-shard-lists.mjs', import.meta.url)), directory], {
      timeout: 50_000, maxBuffer: 64 * 1024 * 1024,
    });
    const { expected, selected, overlap } = JSON.parse(await readFile(join(directory, 'coverage.json'), 'utf8'));
    assert.ok(expected.length);
    assert.equal(selected.length, 18);
    assert.ok(selected.every(identities => identities.length));
    // Compare a multiset, preserving duplicate selections across actual shards.
    assertExactlyOnce(expected, selected);
    assert.throws(() => assertExactlyOnce(expected, [overlap, ...selected.slice(1)]), /every identity exactly once/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test('an unsupported pinned native discovery API fails with an explicit diagnostic', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'terminay-native-api-'));
  try {
    for (const part of ['common', 'runner']) {
      await mkdir(join(directory, 'lib', part), { recursive: true });
      await writeFile(join(directory, 'lib', part, 'index.js'), 'module.exports = {};');
    }
    assert.throws(() => nativePlaywrightAPI(directory), /Pinned Playwright native shard verification API is unsupported/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
