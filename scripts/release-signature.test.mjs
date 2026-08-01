import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const script = new URL('./release-signature.mjs', import.meta.url)

function keys() {
  const pair = generateKeyPairSync('ed25519')
  return {
    TERMINAY_RELEASE_SIGNING_PRIVATE_KEY_B64: Buffer.from(pair.privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64'),
    TERMINAY_RELEASE_SIGNING_PUBLIC_KEY_B64: Buffer.from(pair.publicKey.export({ type: 'spki', format: 'pem' })).toString('base64'),
  }
}

function run(command, payload, signature, env) {
  return spawnSync(process.execPath, [script.pathname, command, payload, signature], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

test('signs and verifies the exact regular archive with an Ed25519 keypair', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'terminay-release-signature-'))
  const payload = join(directory, 'terminay-server.tgz')
  const signature = `${payload}.sig`
  await writeFile(payload, 'archive-bytes')
  const env = keys()

  assert.equal(run('sign', payload, signature, env).status, 0)
  assert.equal((await readFile(signature)).length, 64)
  assert.equal(run('verify', payload, signature, env).status, 0)

  await writeFile(payload, 'tampered')
  assert.notEqual(run('verify', payload, signature, env).status, 0)
})

test('refuses symlinked payloads and non-Ed25519 keys', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'terminay-release-signature-'))
  const realPayload = join(directory, 'real.tgz')
  const payload = join(directory, 'payload.tgz')
  const signature = `${payload}.sig`
  await writeFile(realPayload, 'archive-bytes')
  await symlink(realPayload, payload)
  assert.notEqual(run('sign', payload, signature, keys()).status, 0)

  const badKeys = keys()
  badKeys.TERMINAY_RELEASE_SIGNING_PUBLIC_KEY_B64 = Buffer.from('not a key').toString('base64')
  assert.notEqual(run('verify', realPayload, signature, badKeys).status, 0)
})
