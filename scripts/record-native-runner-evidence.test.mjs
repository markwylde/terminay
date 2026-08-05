import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import {
  assertCleanWorktreeExceptArtifact,
  validateNativeRunnerIdentity,
  verifiedArtifactDigest,
  verifyNativeRunnerEvidence,
} from './record-native-runner-evidence.mjs'

const execFileAsync = promisify(execFile)

test('native runner evidence accepts only the exact x64 identity tuple', () => {
  assert.deepEqual(
    validateNativeRunnerIdentity({
      nodeArch: 'x64',
      platform: 'linux',
      runnerArch: 'X64',
      target: 'linux-x64',
      uname: 'x86_64',
    }),
    { node: 'x64', runner: 'X64', uname: 'x86_64' },
  )
})

test('native runner evidence accepts only the exact arm64 identity tuple', () => {
  assert.deepEqual(
    validateNativeRunnerIdentity({
      nodeArch: 'arm64',
      platform: 'linux',
      runnerArch: 'ARM64',
      target: 'linux-arm64',
      uname: 'aarch64',
    }),
    { node: 'arm64', runner: 'ARM64', uname: 'aarch64' },
  )
})

test('native runner evidence fails closed for emulation, a foreign platform, or an invalid target', () => {
  const x64 = {
    nodeArch: 'x64', platform: 'linux', runnerArch: 'X64', target: 'linux-x64', uname: 'x86_64',
  }
  assert.throws(() => validateNativeRunnerIdentity({ ...x64, nodeArch: 'arm64' }), /does not match/u)
  assert.throws(() => validateNativeRunnerIdentity({ ...x64, platform: 'darwin' }), /does not match/u)
  assert.throws(() => validateNativeRunnerIdentity({ ...x64, target: 'linux-riscv64' }), /--target/u)
})

test('native runner evidence records only a regular artifact with exact bytes and sha256', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'terminay-native-evidence-'))
  try {
    const artifact = join(directory, 'terminay-server.tgz')
    await writeFile(artifact, 'native-probe-payload')
    assert.deepEqual(await verifiedArtifactDigest(artifact), {
      bytes: 20,
      sha256: 'd5af0007d0ffd04ab0b13522fee8ed9040876716da2bec6a38dcd0ac90401835',
    })
    await symlink(artifact, join(directory, 'substituted.tgz'))
    await assert.rejects(verifiedArtifactDigest(join(directory, 'substituted.tgz')), /regular non-symlink/u)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('native runner recording permits only its exact untracked artifact in an otherwise clean worktree', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'terminay-native-clean-worktree-'))
  try {
    await execFileAsync('git', ['init', '--quiet'], { cwd: directory })
    const artifact = join(directory, 'terminay-server.tgz')
    await writeFile(artifact, 'candidate')
    await assert.doesNotReject(
      assertCleanWorktreeExceptArtifact(artifact, { cwd: directory }),
    )
    await writeFile(join(directory, 'unexpected-source.ts'), 'export const changed = true\n')
    await assert.rejects(
      assertCleanWorktreeExceptArtifact(artifact, { cwd: directory }),
      /clean worktree/u,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('native runner release evidence binds one regular archive to its target and immutable commit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'terminay-native-evidence-verify-'))
  try {
    const artifact = join(directory, 'terminay-server.tgz')
    const evidencePath = join(directory, 'linux-x64.json')
    await writeFile(artifact, 'native-release-archive')
    const digest = await verifiedArtifactDigest(artifact)
    const commit = 'a'.repeat(40)
    await writeFile(evidencePath, `${JSON.stringify({
      artifact: digest,
      commit,
      node: { arch: 'x64', version: 'v24.14.0' },
      runner: { arch: 'X64', os: 'Linux' },
      repository: { clean: true },
      schemaVersion: 1,
      target: 'linux-x64',
      uname: 'x86_64',
    })}\n`)
    assert.deepEqual(await verifyNativeRunnerEvidence({
      artifact,
      evidencePath,
      expectedCommit: commit,
      target: 'linux-x64',
    }), {
      artifact: digest,
      commit,
      identity: { node: 'x64', runner: 'X64', uname: 'x86_64' },
      target: 'linux-x64',
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('native runner release evidence rejects substituted bytes, symlinks, and cross-target or cross-commit records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'terminay-native-evidence-reject-'))
  try {
    const artifact = join(directory, 'terminay-server.tgz')
    const evidencePath = join(directory, 'linux-x64.json')
    const commit = 'b'.repeat(40)
    await writeFile(artifact, 'original-archive')
    const digest = await verifiedArtifactDigest(artifact)
    const evidence = {
      artifact: digest,
      commit,
      node: { arch: 'x64', version: 'v24.14.0' },
      runner: { arch: 'X64', os: 'Linux' },
      repository: { clean: true },
      schemaVersion: 1,
      target: 'linux-x64',
      uname: 'x86_64',
    }
    await writeFile(evidencePath, `${JSON.stringify(evidence)}\n`)
    await writeFile(artifact, 'substituted-archive')
    await assert.rejects(
      verifyNativeRunnerEvidence({ artifact, evidencePath, expectedCommit: commit, target: 'linux-x64' }),
      /does not match the exact archive bytes/u,
    )
    await writeFile(artifact, 'original-archive')
    await assert.rejects(
      verifyNativeRunnerEvidence({ artifact, evidencePath, expectedCommit: 'c'.repeat(40), target: 'linux-x64' }),
      /does not match the immutable release commit/u,
    )
    await assert.rejects(
      verifyNativeRunnerEvidence({ artifact, evidencePath, expectedCommit: commit, target: 'linux-arm64' }),
      /target does not match/u,
    )
    const symlinkPath = join(directory, 'evidence-link.json')
    await symlink(evidencePath, symlinkPath)
    await assert.rejects(
      verifyNativeRunnerEvidence({ artifact, evidencePath: symlinkPath, expectedCommit: commit, target: 'linux-x64' }),
      /regular non-symlink/u,
    )
    await writeFile(evidencePath, `${JSON.stringify({
      ...evidence,
      repository: { clean: false },
    })}\n`)
    await assert.rejects(
      verifyNativeRunnerEvidence({ artifact, evidencePath, expectedCommit: commit, target: 'linux-x64' }),
      /clean worktree/u,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
