import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

const runtimeModule = await importTransformed('../electron/dictation/parakeetRuntime.ts')
const settingsModule = await importTransformed('../src/terminalSettings.ts')

test('Parakeet is exposed only on Apple Silicon macOS', async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'terminay-parakeet-platform-'))
  const unsupported = new runtimeModule.ParakeetRuntime({
    arch: 'x64',
    platform: 'darwin',
    rootDirectory,
  })
  assert.equal((await unsupported.getStatus()).state, 'unsupported')

  const supported = new runtimeModule.ParakeetRuntime({
    arch: 'arm64',
    platform: 'darwin',
    rootDirectory,
  })
  assert.equal((await supported.getStatus()).state, 'not-installed')
})

test('existing dictation settings migrate to OpenAI and Parakeet pins its model', () => {
  const existing = settingsModule.normalizeTerminalSettings({
    dictation: { enabled: true, model: 'gpt-4o-mini-transcribe' },
  })
  assert.equal(existing.dictation.provider, 'openai')
  assert.equal(existing.dictation.model, 'gpt-4o-mini-transcribe')

  const parakeet = settingsModule.normalizeTerminalSettings({
    dictation: {
      enabled: true,
      model: 'attacker/arbitrary-model',
      provider: 'parakeet',
    },
  })
  assert.equal(parakeet.dictation.provider, 'parakeet')
  assert.equal(parakeet.dictation.model, 'mlx-community/parakeet-tdt-0.6b-v3')
})

test('Parakeet supply chain and required audio form are exact and diagnosable', async () => {
  assert.equal(runtimeModule.PARAKEET_MLX_VERSION, '0.5.2')
  assert.equal(runtimeModule.PARAKEET_MLX_LICENSE, 'Apache-2.0')
  assert.equal(runtimeModule.PARAKEET_MODEL_REVISION, 'ed2b7e8c15f9aaa0b5772e2efb986255eaef7e15')
  assert.equal(runtimeModule.PARAKEET_MODEL_LICENSE, 'CC-BY-4.0')
  assert.deepEqual(
    runtimeModule.parakeetFfmpegArguments('/private/input.webm', '/private/output.wav'),
    ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', '/private/input.webm', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '/private/output.wav'],
  )
  const rootDirectory = await mkdtemp(join(tmpdir(), 'terminay-parakeet-disclosure-'))
  const status = await new runtimeModule.ParakeetRuntime({ arch: 'x64', platform: 'darwin', rootDirectory }).getStatus()
  assert.deepEqual(status.engine, { license: 'Apache-2.0', package: 'parakeet-mlx', version: '0.5.2' })
  assert.equal(status.modelRevision, 'ed2b7e8c15f9aaa0b5772e2efb986255eaef7e15')
  assert.equal(status.modelLicense, 'CC-BY-4.0')
  assert.equal(status.audioFormat, 'WAV PCM signed 16-bit mono 16 kHz')
  assert.equal(JSON.stringify(status).includes(rootDirectory), false)
})

async function importTransformed(relativePath) {
  const sourcePath = new URL(relativePath, import.meta.url)
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-parakeet-test-'))
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
