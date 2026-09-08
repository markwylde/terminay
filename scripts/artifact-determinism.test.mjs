import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { describeArtifactFiles, normalizeArtifactModes, walkRegularTree } from './artifact-determinism.mjs'
import { PTY_RUNTIME_PLATFORMS } from './pty-runtime-platforms.mjs'

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

test('the standalone builder gates architecture on the shipped ELF bytes, not on the runner', async (t) => {
  // The builder refuses every non-Linux host before it reaches either gate, so
  // the two are only distinguishable on a release-shaped runner.
  if (process.platform !== 'linux') return t.skip('requires a Linux runner')
  const scratch = await mkdtemp(join(tmpdir(), 'terminay-builder-gate-'))
  try {
    const nodeArchive = join(scratch, 'node.tar.xz')
    await writeFile(nodeArchive, 'not the pinned archive')
    const common = [
      '--node-archive', nodeArchive,
      '--runtime-modules', join(scratch, 'node_modules'),
      '--output-dir', join(scratch, 'out'),
      '--webrtc-runtime', join(scratch, 'webrtc-runtime'),
      '--revision', 'd'.repeat(40),
    ]
    for (const target of Object.keys(PTY_RUNTIME_PLATFORMS)) {
      const architecture = PTY_RUNTIME_PLATFORMS[target].architecture
      const permissive = await runBuilder(['--target', target, ...common])
      assert.doesNotMatch(permissive.stderr, /requires native/u, `${target} must stage on a non-native runner`)
      assert.match(permissive.stderr, /pinned Node archive SHA-256/u, `${target} must still verify the bytes it stages`)

      const strict = await runBuilder(['--target', target, ...common, '--require-native-runner', 'true'])
      if (architecture === process.arch) assert.match(strict.stderr, /pinned Node archive SHA-256/u)
      else assert.match(strict.stderr, new RegExp(`${target} requires native ${architecture}`, 'u'))
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})

function runBuilder(args) {
  return new Promise((resolve, reject) => {
    const script = fileURLToPath(new URL('build-standalone-server-artifact.mjs', import.meta.url))
    const child = spawn(process.execPath, [script, ...args], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => resolve({ code, stdout, stderr }))
  })
}
