// Exercise the same native discovery/filter pipeline used by Playwright's CLI,
// in one isolated process so each shard reuses the already-loaded test modules.
// These internal exports belong to our pinned Playwright; an incompatible update
// fails explicitly rather than falling back to our own selector implementation.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listedTests, timingKey, sharesSetup, shardTestLists } from './e2e-shard-test-list.mjs';

const require = createRequire(import.meta.url);
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

export function nativePlaywrightAPI(playwrightRoot = dirname(require.resolve('playwright/package.json'))) {
  let configLoader, testRunner;
  try {
    ({ configLoader } = require(join(playwrightRoot, 'lib/common/index.js')));
    ({ testRunner } = require(join(playwrightRoot, 'lib/runner/index.js')));
    if (typeof configLoader?.loadConfigFromFile !== 'function' || typeof testRunner?.runAllTestsWithConfig !== 'function')
      throw new Error('native configuration/discovery exports are missing');
  } catch (error) {
    throw new Error(`Pinned Playwright native shard verification API is unsupported: ${error.message}`);
  }
  return { configLoader, testRunner };
}

export function assertExactlyOnce(expected, selected) {
  assert.deepEqual(selected.flat().sort(), [...expected].sort(), 'Native shard selections must cover every identity exactly once');
}

export async function verifyNativeShardLists(directory) {
  const { configLoader, testRunner } = nativePlaywrightAPI();
  const list = async (testList, index) => {
    const report = join(directory, `native-${index}.json`);
    const config = await configLoader.loadConfigFromFile(undefined, { reporter: [['json', { outputFile: report }]] });
    const status = await testRunner.runAllTestsWithConfig(config, { listMode: true, ...(testList ? { testList } : {}) });
    assert.equal(status, 'passed', `Native Playwright discovery failed for ${testList ?? 'the complete suite'}`);
    return JSON.parse(await readFile(report, 'utf8'));
  };
  const listing = await list(undefined, 0);
  const sources = new Map();
  for (const test of listedTests(listing)) {
    if (!sources.has(test.file)) sources.set(test.file, sharesSetup(await readFile(join(listing.config.rootDir, test.file), 'utf8')));
  }
  const snapshot = JSON.parse(await readFile(new URL('./e2e-duration-snapshot.json', import.meta.url), 'utf8'));
  const lists = shardTestLists(listing, file => sources.get(file), 18, snapshot.durations);
  const selected = [];
  for (let index = 0; index < lists.length; index++) {
    const path = join(directory, `shard-${index + 1}.txt`);
    await writeFile(path, lists[index].join('\n'));
    selected.push(listedTests(await list(path, index + 1)).map(timingKey));
  }
  const result = { expected: listedTests(listing).map(timingKey), selected };
  // Preserve duplicates: a union would conceal overlap in native selections.
  assertExactlyOnce(result.expected, selected);
  // An actual native overlapping selection is the negative control for the
  // coverage checker: union-only validation would accept this assignment.
  const overlapPath = join(directory, 'overlap.txt');
  await writeFile(overlapPath, [...lists[0], ...lists[1]].join('\n'));
  result.overlap = listedTests(await list(overlapPath, 'overlap')).map(timingKey);
  await writeFile(join(directory, 'coverage.json'), JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = process.argv[2];
  if (!directory) throw new Error('Usage: verify-native-e2e-shard-lists.mjs RESULT_DIRECTORY');
  process.chdir(repositoryRoot);
  await verifyNativeShardLists(resolve(directory));
}
