import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageImmutableRendererArtifact } from '../../scripts/immutable-renderer-artifact.mjs';

/** One immutable application bundle per worker; profiles remain test-owned. */
export async function createWorkerRendererArtifact(sourceRoot) {
  const parent = await mkdtemp(join(tmpdir(), 'terminay-e2e-worker-renderer-'));
  try {
    const artifact = await stageImmutableRendererArtifact({ sourceRoot, destinationParent: parent });
    return Object.freeze({
      ...artifact,
      async close() {
        try { await artifact.assertUnchanged(); }
        finally { await rm(parent, { recursive: true, force: true }); }
      },
    });
  } catch (error) {
    await rm(parent, { recursive: true, force: true });
    throw error;
  }
}
