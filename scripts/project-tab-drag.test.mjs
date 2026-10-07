import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'

const {
  pointInRect,
  distanceToRect,
  computeDropIndex,
  projectDragPreviewWidth,
  createNativeProjectDragSession,
} = await importModule()

const BAR = { x: 100, y: 0, width: 400, height: 40 }

test('pointInRect includes edges and rejects outside points', () => {
  assert.equal(pointInRect({ x: 100, y: 0 }, BAR), true) // top-left corner
  assert.equal(pointInRect({ x: 500, y: 40 }, BAR), true) // bottom-right corner
  assert.equal(pointInRect({ x: 300, y: 20 }, BAR), true) // center
  assert.equal(pointInRect({ x: 99, y: 20 }, BAR), false) // just left
  assert.equal(pointInRect({ x: 300, y: 41 }, BAR), false) // just below
})

test('distanceToRect is zero inside and grows with distance', () => {
  assert.equal(distanceToRect({ x: 300, y: 20 }, BAR), 0)
  // 100px straight below the bar bottom (the tear-off threshold).
  assert.equal(distanceToRect({ x: 300, y: 140 }, BAR), 100)
  // Purely horizontal gap to the left edge.
  assert.equal(distanceToRect({ x: 60, y: 20 }, BAR), 40)
  // Diagonal off the bottom-right corner: 3-4-5 triangle.
  assert.equal(distanceToRect({ x: 503, y: 44 }, BAR), 5)
})

test('computeDropIndex slots before, between, and after tabs by cursor X', () => {
  const centers = [60, 180, 300] // three tabs

  assert.equal(computeDropIndex(centers, 10), 0) // before all
  assert.equal(computeDropIndex(centers, 60), 0) // exactly on first center -> before it
  assert.equal(computeDropIndex(centers, 61), 1) // just past first center
  assert.equal(computeDropIndex(centers, 200), 2) // between 2nd and 3rd
  assert.equal(computeDropIndex(centers, 999), 3) // after all
})

test('computeDropIndex with no tabs always inserts at zero', () => {
  assert.equal(computeDropIndex([], 0), 0)
  assert.equal(computeDropIndex([], 9999), 0)
})

test('projectDragPreviewWidth keeps a tab width inside what the host accepts', () => {
  assert.equal(projectDragPreviewWidth(0), 80) // a collapsed tab
  assert.equal(projectDragPreviewWidth(79), 80)
  assert.equal(projectDragPreviewWidth(80), 80)
  assert.equal(projectDragPreviewWidth(120.6), 121)
  assert.equal(projectDragPreviewWidth(2000), 2000)
  assert.equal(projectDragPreviewWidth(2001), 2000)
  assert.equal(projectDragPreviewWidth(Number.NaN), 80)
})

test('a native drag the host starts ends with the host decision', async () => {
  const calls = []
  const session = createNativeProjectDragSession({
    begin: async (input) => void calls.push(['begin', input]),
    end: async () => {
      calls.push(['end'])
      return { action: 'popout', x: 1, y: 2 }
    },
    onRefused: () => calls.push(['refused']),
  })

  assert.equal(session.requested, false)
  session.start('first')
  session.start('second') // one session per drag
  assert.equal(session.requested, true)
  assert.deepEqual(await session.finish(), { action: 'popout', x: 1, y: 2 })
  assert.deepEqual(calls, [['begin', 'first'], ['end']])
  assert.equal(session.requested, false)
})

test('a native drag the host refuses is reported once and never ended', async () => {
  const refusals = []
  let ends = 0
  const refusal = new Error('workspace drag preview is invalid')
  const session = createNativeProjectDragSession({
    begin: async () => {
      throw refusal
    },
    end: async () => {
      ends += 1
      return { action: 'reorder' }
    },
    onRefused: (error) => refusals.push(error),
  })

  session.start('drag')
  assert.equal(await session.finish(), null)
  assert.deepEqual(refusals, [refusal])
  assert.equal(ends, 0)
  // The next drag from the same window starts clean.
  assert.equal(session.requested, false)
})

test('a drag that never left the strip asks the host nothing', async () => {
  let ends = 0
  const session = createNativeProjectDragSession({
    begin: async () => undefined,
    end: async () => {
      ends += 1
      return { action: 'reorder' }
    },
    onRefused: () => undefined,
  })

  assert.equal(await session.finish(), null)
  assert.equal(ends, 0)
})

async function importModule() {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-project-tab-drag-test-'))
  const outputPath = join(tempDir, 'projectTabDrag.mjs')
  await build({
    bundle: true,
    entryPoints: [new URL('../src/projectTabDrag.ts', import.meta.url).pathname],
    format: 'esm',
    outfile: outputPath,
    platform: 'neutral',
    target: 'es2022',
  })
  return import(outputPath)
}
