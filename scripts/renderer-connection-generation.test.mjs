import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { build } from 'esbuild'
import { join } from 'node:path'
import test from 'node:test'

const bundleDirectory = await mkdtemp(join(process.cwd(), '.renderer-generation-'))
const bundlePath = join(bundleDirectory, 'rendererConnectionGeneration.mjs')
await build({
  entryPoints: ['src/shared/rendererConnectionGeneration.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundlePath,
  logLevel: 'silent',
})
const { RendererConnectionGeneration } = await import(`${bundlePath}?test=${Date.now()}`)
test.after(() => rm(bundleDirectory, { force: true, recursive: true }))

test('renderer connection generation disposes stale and replaced contexts', async () => {
  const disposed = []
  const generation = new RendererConnectionGeneration()
  const oldAttempt = generation.begin('server-a')
  const newAttempt = generation.begin('server-a')

  assert.equal(await generation.activate(oldAttempt, { dispose: () => disposed.push('old') }), false)
  assert.deepEqual(disposed, ['old'])

  assert.equal(await generation.activate(newAttempt, { dispose: () => disposed.push('new') }), true)
  const replacement = generation.begin('server-a')
  assert.equal(await generation.activate(replacement, { dispose: () => disposed.push('replacement') }), true)
  assert.deepEqual(disposed, ['old', 'new'])

  await generation.disposeActive('server-a')
  assert.deepEqual(disposed, ['old', 'new', 'replacement'])
})

test('web and electron renderer paths share the same stale-generation guard', async () => {
  const [web, electron] = await Promise.all([
    readFile(new URL('../src/web/main.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/rendererRuntime.tsx', import.meta.url), 'utf8'),
  ])

  for (const source of [web, electron]) {
    assert.match(source, /RendererConnectionGeneration/u)
    assert.match(source, /connectionGeneration = useRef/u)
    assert.match(source, /\.begin\(/u)
    assert.match(source, /\.activate\(/u)
    assert.match(source, /\.disposeActive\(/u)
  }
})
