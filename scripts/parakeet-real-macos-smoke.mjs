import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { build } from 'esbuild'

if (process.env.TERMINAY_TEST_REAL_PARAKEET !== '1') {
  console.log('Skip: set TERMINAY_TEST_REAL_PARAKEET=1 to install and exercise the real Parakeet model.')
  process.exit(0)
}

assert.equal(process.platform, 'darwin', 'real Parakeet smoke requires macOS')
assert.equal(process.arch, 'arm64', 'real Parakeet smoke requires Apple Silicon')

const execFileAsync = promisify(execFile)
const runtimeModule = await importTransformed('../packages/server-core/src/aiService/parakeetRuntime.ts')
const rootDirectory = process.env.TERMINAY_PARAKEET_SMOKE_ROOT
  ?? join(homedir(), 'Library', 'Caches', 'Terminay', 'parakeet-smoke')
await mkdir(rootDirectory, { recursive: true })

const fixtureDirectory = await mkdtemp(join(tmpdir(), 'terminay-parakeet-audio-'))
const fixturePath = join(fixtureDirectory, 'terminay-dictation.aiff')
await execFileAsync('/usr/bin/say', [
  '-o',
  fixturePath,
  'Terminay local dictation works on this Mac.',
])

const runtime = new runtimeModule.ParakeetRuntime({ rootDirectory })
const installed = await runtime.install()
assert.equal(installed.state, 'ready', installed.message)
const transcript = await runtime.transcribe(fixturePath)
runtime.stop()
assert.match(transcript.toLowerCase(), /local dictation/u)
assert.match(transcript.toLowerCase(), /mac/u)
console.log(`Parakeet real-model smoke passed: ${transcript}`)

async function importTransformed(relativePath) {
  const sourcePath = new URL(relativePath, import.meta.url)
  const outputDirectory = await mkdtemp(join(tmpdir(), 'terminay-parakeet-real-'))
  const outputPath = join(outputDirectory, 'runtime.mjs')
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
