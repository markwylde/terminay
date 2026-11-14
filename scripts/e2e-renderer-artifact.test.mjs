import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkerRendererArtifact } from '../e2e/support/renderer-artifact.mjs';
import { buildUiBundleManifest } from './build-ui-bundle-manifest.mjs';

async function source(root, version) {
  await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<script type="module" src="/assets/app.js"></script>');
  await writeFile(join(root, 'assets', 'app.js'), `export const version = ${version};`);
  await buildUiBundleManifest({ rootDirectory: root, serverVersion: '1.0.0' });
}

test('worker bundle survives source rebuilds across independent launch lifecycles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminay-worker-renderer-test-'));
  let worker;
  try {
    await source(root, 1);
    worker = await createWorkerRendererArtifact(root);
    const artifactRoot = worker.rootDirectory;
    await worker.assertUnchanged();
    await source(root, 2);
    await worker.assertUnchanged();
    assert.equal(await readFile(join(artifactRoot, 'assets', 'app.js'), 'utf8'), 'export const version = 1;');
    await worker.close();
    assert.equal(existsSync(artifactRoot), false);
    worker = undefined;
  } finally {
    if (worker) await worker.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('per-launch integrity detects tampering and worker teardown still removes corrupted bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminay-worker-renderer-corruption-'));
  try {
    await source(root, 1);
    const worker = await createWorkerRendererArtifact(root);
    const asset = join(worker.rootDirectory, 'assets', 'app.js');
    await chmod(asset, 0o644);
    await writeFile(asset, 'corrupt');
    await assert.rejects(worker.assertUnchanged(), /size mismatch|hash mismatch/u);
    await assert.rejects(worker.close(), /size mismatch|hash mismatch/u);
    assert.equal(existsSync(worker.rootDirectory), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
