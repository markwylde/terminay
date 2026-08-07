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

test('a late close callback from a retired generation cannot dispose its replacement', async () => {
  const disposed = []
  const generation = new RendererConnectionGeneration()
  const oldAttempt = generation.begin('server-a')
  await generation.activate(oldAttempt, { dispose: () => disposed.push('old') })

  const recoverOld = () => {
    if (!generation.isCurrent(oldAttempt)) return false
    void generation.disposeActive('server-a')
    return true
  }
  assert.equal(recoverOld(), true)
  assert.deepEqual(disposed, ['old'])

  const replacementAttempt = generation.begin('server-a')
  await generation.activate(replacementAttempt, {
    dispose: () => disposed.push('replacement'),
  })

  assert.equal(recoverOld(), false)
  assert.deepEqual(disposed, ['old'])
  await generation.disposeActive('server-a')
  assert.deepEqual(disposed, ['old', 'replacement'])
})

test('supersession while disposing the previous context cannot retain a disposed candidate', async () => {
  let releasePrevious
  const previousDisposed = new Promise((resolve) => {
    releasePrevious = resolve
  })
  const disposed = []
  const generation = new RendererConnectionGeneration()
  const initial = generation.begin('server-a')
  await generation.activate(initial, {
    dispose: async () => {
      disposed.push('initial')
      await previousDisposed
    },
  })

  const staleAttempt = generation.begin('server-a')
  const staleActivation = generation.activate(staleAttempt, {
    dispose: () => disposed.push('stale'),
  })
  await Promise.resolve()
  const currentAttempt = generation.begin('server-a')
  const currentActivation = generation.activate(currentAttempt, {
    dispose: () => disposed.push('current'),
  })

  releasePrevious()
  assert.equal(await staleActivation, false)
  assert.equal(await currentActivation, true)
  assert.deepEqual(disposed, ['initial', 'stale'])
  await generation.disposeActive('server-a')
  assert.deepEqual(disposed, ['initial', 'stale', 'current'])
})

test('dispose fences a candidate waiting for previous-context disposal', async () => {
  let releasePrevious
  const previousDisposed = new Promise((resolve) => { releasePrevious = resolve })
  const disposed = []
  const generation = new RendererConnectionGeneration()
  const initial = generation.begin('server-a')
  await generation.activate(initial, {
    dispose: async () => {
      disposed.push('initial')
      await previousDisposed
    },
  })

  const candidate = generation.begin('server-a')
  const activation = generation.activate(candidate, {
    dispose: () => disposed.push('candidate'),
  })
  await Promise.resolve()
  const disposal = generation.disposeActive('server-a')
  releasePrevious()

  assert.equal(await activation, false)
  await disposal
  assert.deepEqual(disposed, ['initial', 'candidate'])
  assert.equal(generation.isCurrent(candidate), false)
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
	assert.match(web, /isCurrent\(attempt\)[\s\S]*stale-close-ignored/u)
})
