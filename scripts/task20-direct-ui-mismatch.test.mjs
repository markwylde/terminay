import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createLocalUiServer } from '../apps/terminay-server/dist/index.js'
import { checkCompatibilityMatrix, deriveUiBundleId } from '../packages/server-core/dist/index.js'

test('direct server UI remains available when the Desktop host version is incompatible', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminay-task20-direct-ui-'))
  const body = Buffer.from('<!doctype html><title>server-owned-ui</title>')
  try {
    await writeFile(join(root, 'index.html'), body)
    const asset = {
      contentType: 'text/html; charset=utf-8',
      hash: createHash('sha256').update(body).digest('base64url'),
      path: '/remote-app/provisional/index.html',
      size: body.byteLength,
    }
    const bundleId = deriveUiBundleId([asset], 'provisional')
    const manifest = {
      schemaVersion: 1,
      bundleId,
      serverVersion: '2.0.0',
      protocolVersion: '1',
      entryPath: `/remote-app/${bundleId}/index.html`,
      assets: [{ ...asset, path: asset.path.replace('provisional', bundleId) }],
    }
    await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest))

    const compatibility = checkCompatibilityMatrix(
      { desktop: '0.9.0', server: '2.0.0', ui: '2.0.0', bootstrap: '1.0.0', signaling: '1.0.0' },
      { desktop: { minimum: '1.0.0' }, server: { minimum: '2.0.0' }, ui: { minimum: '2.0.0' }, bootstrap: { minimum: '1.0.0' }, signaling: { minimum: '1.0.0' } },
    )
    assert.deepEqual(compatibility.map((failure) => failure.component), ['desktop'])

    const server = createLocalUiServer({ rootDirectory: root, serverId: 'server-a', serverVersion: '2.0.0', authToken: 'task20-direct-ui-token' })
    const address = await server.start()
    try {
      const response = await fetch(`${address.origin}/`, { headers: { Authorization: 'Bearer task20-direct-ui-token' } })
      assert.equal(response.status, 200)
      assert.equal(await response.text(), body.toString('utf8'))
    } finally {
      await server.stop()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
