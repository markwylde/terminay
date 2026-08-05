import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'
import { inspectArchiveIndex, probeStandaloneServerArchive } from './probe-standalone-server-archive.mjs'

const execFileAsync = promisify(execFile)

async function createArchive({ rootName, members }) {
  const temporary = await mkdtemp(join(tmpdir(), 'terminay-archive-probe-test-'))
  const root = join(temporary, rootName)
  await mkdir(root, { recursive: true })
  for (const [path, body] of Object.entries(members)) {
    const destination = join(root, ...path.split('/'))
    await mkdir(join(destination, '..'), { recursive: true })
    await writeFile(destination, body)
  }
  const archive = join(temporary, 'archive.tar.gz')
  await execFileAsync('tar', ['-czf', archive, '-C', temporary, rootName])
  return { archive, temporary }
}

test('archive probe accepts only the exact target root and safe member paths', async () => {
  const rootName = 'terminay-server-node24.14.0-linux-x64'
  const fixture = await createArchive({ rootName, members: { 'artifact-manifest.json': '{}' } })
  try {
    assert.equal(await inspectArchiveIndex(fixture.archive, 'linux-x64'), rootName)
  } finally {
    await rm(fixture.temporary, { recursive: true, force: true })
  }
})

test('archive probe rejects a target/root mismatch before extraction', async () => {
  const fixture = await createArchive({
    rootName: 'terminay-server-node24.14.0-linux-arm64',
    members: { 'artifact-manifest.json': '{}' },
  })
  try {
    await assert.rejects(() => inspectArchiveIndex(fixture.archive, 'linux-x64'), /root must be/u)
  } finally {
    await rm(fixture.temporary, { recursive: true, force: true })
  }
})

test('archive probe rejects symlink members before extraction', async () => {
  const rootName = 'terminay-server-node24.14.0-linux-x64'
  const fixture = await createArchive({ rootName, members: { 'artifact-manifest.json': '{}' } })
  try {
    await symlink('/tmp', join(fixture.temporary, rootName, 'escape'))
    await execFileAsync('tar', ['-czf', fixture.archive, '-C', fixture.temporary, rootName])
    await assert.rejects(() => inspectArchiveIndex(fixture.archive, 'linux-x64'), /non-regular tar member/u)
  } finally {
    await rm(fixture.temporary, { recursive: true, force: true })
  }
})

test('archive probe refuses execution outside matching native Linux', async () => {
  await assert.rejects(
    () => probeStandaloneServerArchive({ archivePath: '/not-used.tar.gz', target: 'linux-x64' }),
    /native Linux/u,
  )
})
