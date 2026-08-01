import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { describeArtifactFiles, normalizeArtifactModes, walkRegularTree } from './artifact-determinism.mjs'

test('artifact inventory is sorted, hashed, and rejects symbolic links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminay-artifact-tree-'))
  try {
    await mkdir(join(root, 'nested'))
    await writeFile(join(root, 'z.txt'), 'z')
    await writeFile(join(root, 'nested', 'a.txt'), 'a')
    await normalizeArtifactModes(root)
    assert.deepEqual(await describeArtifactFiles(root), [
      { path: 'nested/a.txt', mode: '644', size: 1, sha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb' },
      { path: 'z.txt', mode: '644', size: 1, sha256: '594e519ae499312b29433b7dd8a97ff068defcba9755b6d5d00e84c524d67b06' },
    ])
    await symlink(join(root, 'z.txt'), join(root, 'linked.txt'))
    await assert.rejects(() => walkRegularTree(root), /symbolic link/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
