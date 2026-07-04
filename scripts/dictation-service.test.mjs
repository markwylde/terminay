import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'

const {
  DictationService,
  MAX_DICTATION_UPLOAD_BYTES,
} = await importTransformed('../electron/dictation/service.ts')

test('rejects empty dictation audio', async () => {
  const service = new DictationService({ apiKeyProvider: () => 'test-key' })

  await assert.rejects(
    () => service.transcribe({ audioBase64: '', mimeType: 'audio/webm' }),
    /audio is empty/i,
  )
})

test('rejects dictation audio above the upload limit before reading an API key', async () => {
  let apiKeyRead = false
  const service = new DictationService({
    apiKeyProvider: () => {
      apiKeyRead = true
      return 'test-key'
    },
  })
  const oversizedBase64 = `${'A'.repeat(Math.ceil(((MAX_DICTATION_UPLOAD_BYTES + 1) * 4) / 3))}==`

  await assert.rejects(
    () => service.transcribe({ audioBase64: oversizedBase64, mimeType: 'audio/webm' }),
    /25 MB upload limit/i,
  )
  assert.equal(apiKeyRead, false)
})

test('requires a MIME type', async () => {
  const service = new DictationService({ apiKeyProvider: () => 'test-key' })

  await assert.rejects(
    () => service.transcribe({ audioBase64: Buffer.from('audio').toString('base64'), mimeType: '' }),
    /MIME type is required/i,
  )
})

test('rejects valid audio when the OpenAI API key is missing', async () => {
  const service = new DictationService({ apiKeyProvider: () => null })

  await assert.rejects(
    () => service.transcribe({ audioBase64: Buffer.from('audio').toString('base64'), mimeType: 'audio/webm' }),
    /API key is not configured/i,
  )
})

async function importTransformed(relativePath) {
  const sourcePath = new URL(relativePath, import.meta.url)
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-dictation-service-test-'))
  const outputPath = join(tempDir, `${relativePath.split('/').pop()}.mjs`)
  await build({
    bundle: true,
    entryPoints: [sourcePath.pathname],
    format: 'esm',
    outfile: outputPath,
    platform: 'node',
    target: 'node20',
  })
  return import(outputPath)
}
