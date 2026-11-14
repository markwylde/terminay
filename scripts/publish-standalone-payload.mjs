import { lstat, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createDeterministicTarGz, sha256File } from './artifact-determinism.mjs';

/** Publish the already verified tree directly to an image, or archive it for distribution. */
export async function publishStandalonePayload({ stagingDirectory, rootName, outputDirectory, outputTree, compressionLevel = 9 }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(rootName)) throw new Error('artifact root name is unsafe');
  if (outputTree) {
    try {
      await lstat(outputTree);
      throw new Error(`Output already exists: ${outputTree}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(dirname(outputTree), { recursive: true });
    await rename(join(stagingDirectory, rootName), outputTree);
    return { rootDirectory: outputTree };
  }
  await mkdir(outputDirectory, { recursive: true });
  const archivePath = await createDeterministicTarGz({ archivePath: join(outputDirectory, `${rootName}.tar.gz`), rootName, stagingDirectory, compressionLevel });
  return { archivePath, archiveSha256: await sha256File(archivePath) };
}
