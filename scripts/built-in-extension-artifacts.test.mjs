import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { stageBuiltInExtensions } from './stage-built-in-extensions.mjs';
import { copyBuiltInExtensionArtifacts } from './copy-built-in-extension-artifacts.mjs';
import { verifyBuiltInExtensionArtifacts } from './verify-built-in-extension-artifacts.mjs';

test('all six built-ins stage as verified offline trees and Electron/standalone copies remain byte-identical', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminay-built-in-artifacts-'));
  try {
    const staged = join(root, 'staged');
    const result = await stageBuiltInExtensions({ outputDirectory: staged, skipChecks: true });
    assert.equal(result.inventory.artifacts.length, 6);
    assert.equal(result.inventory.artifacts.some((artifact) => artifact.files.some((file) => file.path.endsWith('/.npmignore'))), false);
    await verifyBuiltInExtensionArtifacts(staged);
    const electron = join(root, 'electron-resource');
    const standalone = join(root, 'standalone-dist');
    await copyBuiltInExtensionArtifacts(staged, electron);
    await copyBuiltInExtensionArtifacts(staged, standalone);
    assert.deepEqual(await readFile(join(electron, 'inventory.v1.json')), await readFile(join(standalone, 'inventory.v1.json')));
    const first = result.inventory.artifacts[0];
    assert.deepEqual(await readFile(join(electron, first.directory, 'package.tgz')), await readFile(join(standalone, first.directory, 'package.tgz')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('inventory verification rejects a release artifact tree changed after staging', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminay-built-in-tamper-'));
  try {
    const staged = join(root, 'staged');
    const result = await stageBuiltInExtensions({ outputDirectory: staged, skipChecks: true });
    const first = result.inventory.artifacts[0];
    await writeFile(join(staged, first.directory, 'package.tgz'), 'tampered');
    await assert.rejects(verifyBuiltInExtensionArtifacts(staged), /differs from release inventory/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('release verification fails closed for an absent inventory and a stale dependency tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminay-built-in-missing-'));
  try {
    const staged = join(root, 'staged');
    const result = await stageBuiltInExtensions({ outputDirectory: staged, skipChecks: true });
    const first = result.inventory.artifacts[0];
    await unlink(join(staged, 'inventory.v1.json'));
    await assert.rejects(verifyBuiltInExtensionArtifacts(staged), /inventory|ENOENT/u);

    await stageBuiltInExtensions({ outputDirectory: staged, skipChecks: true });
    await writeFile(join(staged, first.directory, 'node_modules', first.packageName, 'package.json'), '{"stale":true}\n');
    await assert.rejects(verifyBuiltInExtensionArtifacts(staged), /differs from release inventory/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
