import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'

const { pointInRect, distanceToRect, computeDropIndex } = await importModule()

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
