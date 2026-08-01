import assert from 'node:assert/strict'
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const script = new URL('./release-checksum.mjs', import.meta.url)

function run(command, payload, checksum) {
  return spawnSync(process.execPath, [script.pathname, command, payload, checksum], { encoding: 'utf8' })
}

test('writes and verifies an exact basename-bound release checksum', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'terminay-release-checksum-'))
  const payload = join(directory, 'terminay-server.tgz')
  const checksum = `${payload}.sha256`
  await writeFile(payload, 'archive-bytes')

  assert.equal(run('write', payload, checksum).status, 0)
  assert.match(await readFile(checksum, 'utf8'), /^[a-f0-9]{64} {2}terminay-server\.tgz\n$/u)
  assert.equal(run('verify', payload, checksum).status, 0)

  await writeFile(payload, 'tampered')
  assert.notEqual(run('verify', payload, checksum).status, 0)
})

test('refuses symlinked payloads and checksum sidecars', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'terminay-release-checksum-'))
  const realPayload = join(directory, 'real.tgz')
  const payload = join(directory, 'payload.tgz')
  const checksum = `${payload}.sha256`
  await writeFile(realPayload, 'archive-bytes')
  await symlink(realPayload, payload)
  assert.notEqual(run('write', payload, checksum).status, 0)

  const realChecksum = join(directory, 'real.sha256')
  await writeFile(realChecksum, `${'0'.repeat(64)}  real.tgz\n`)
  await symlink(realChecksum, checksum)
  assert.notEqual(run('verify', realPayload, checksum).status, 0)
})

test('refuses replacing an existing checksum sidecar', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'terminay-release-checksum-'))
  const payload = join(directory, 'terminay-server.tgz')
  const checksum = `${payload}.sha256`
  await writeFile(payload, 'archive-bytes')
  await writeFile(checksum, 'existing')
  assert.notEqual(run('write', payload, checksum).status, 0)
})
