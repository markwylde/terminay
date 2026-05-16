import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'

const { readJsonBody } = await importRemoteService()

test('readJsonBody parses bounded remote JSON bodies', async () => {
  const body = await readJsonBody(createChunkedRequest([
    '{"deviceName":"Phone",',
    '"pairingPin":"123456"}',
  ]))

  assert.deepEqual(body, {
    deviceName: 'Phone',
    pairingPin: '123456',
  })
})

test('readJsonBody rejects oversized remote JSON bodies', async () => {
  await assert.rejects(
    () => readJsonBody(createChunkedRequest([
      '{"padding":"',
      'x'.repeat(70 * 1024),
      '"}',
    ])),
    /too large/,
  )
})

async function importRemoteService() {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-remote-json-body-test-'))
  const outputPath = join(tempDir, 'jsonBody.mjs')
  await build({
    bundle: true,
    entryPoints: [new URL('../electron/remote/jsonBody.ts', import.meta.url).pathname],
    format: 'esm',
    outfile: outputPath,
    platform: 'node',
    target: 'node20',
  })
  return import(outputPath)
}

async function* createChunkedRequest(chunks) {
  for (const chunk of chunks) {
    yield Buffer.from(chunk)
  }
}
