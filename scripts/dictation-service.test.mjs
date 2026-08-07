import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, stat } from 'node:fs/promises'
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

test('on-device Parakeet does not read the OpenAI key and removes temporary audio', async () => {
  let apiKeyRead = false
  let audioPath
  const service = new DictationService({
    apiKeyProvider: () => {
      apiKeyRead = true
      return null
    },
    providerProvider: () => 'parakeet',
    parakeetRuntime: {
      async transcribe(path) {
        audioPath = path
        assert.equal((await stat(path)).isFile(), true)
        return 'local transcript'
      },
    },
  })

  const result = await service.transcribe({
    audioBase64: Buffer.from('audio').toString('base64'),
    mimeType: 'audio/webm',
    model: 'gpt-4o-transcribe',
  })
  assert.equal(result.text, 'local transcript')
  assert.equal(result.model, 'mlx-community/parakeet-tdt-0.6b-v3')
  assert.equal(apiKeyRead, false)
  await assert.rejects(stat(audioPath), /ENOENT/u)
})

test('on-device Parakeet never falls back to OpenAI after a local failure', async () => {
  let openAiCreated = false
  const service = new DictationService({
    apiKeyProvider: () => 'test-key',
    providerProvider: () => 'parakeet',
    parakeetRuntime: { transcribe: async () => { throw new Error('local failure') } },
    openaiFactory: () => {
      openAiCreated = true
      throw new Error('must not be called')
    },
  })

  await assert.rejects(
    () => service.transcribe({ audioBase64: Buffer.from('audio').toString('base64'), mimeType: 'audio/webm' }),
    /local failure/u,
  )
  assert.equal(openAiCreated, false)
})

test('removes file-backed temporary audio after provider success and failure', async () => {
  const originalFile = globalThis.File
  globalThis.File = undefined
  try {
    let successfulPath
    const successfulService = new DictationService({
      apiKeyProvider: () => 'test-key',
      openaiFactory: () => ({
        audio: {
          transcriptions: {
            async create({ file }) {
              successfulPath = file.path
              return { text: 'safe transcript' }
            },
          },
        },
      }),
    })
    const request = { audioBase64: Buffer.from('audio').toString('base64'), mimeType: 'audio/webm' }
    assert.equal((await successfulService.transcribe(request)).text, 'safe transcript')
    assert.equal(typeof successfulPath, 'string')
    await assert.rejects(stat(successfulPath), /ENOENT/u)

    let failedPath
    const failingService = new DictationService({
      apiKeyProvider: () => 'test-key',
      openaiFactory: () => ({
        audio: {
          transcriptions: {
            async create({ file }) {
              failedPath = file.path
              throw new Error('provider failed')
            },
          },
        },
      }),
    })
    await assert.rejects(() => failingService.transcribe(request), /provider failed/u)
    assert.equal(typeof failedPath, 'string')
    await assert.rejects(stat(failedPath), /ENOENT/u)
  } finally {
    globalThis.File = originalFile
  }
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
