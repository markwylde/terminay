import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import test from 'node:test'
import { build } from 'esbuild'

const { buildServerUiArchive } = await importArchiveBuilder()

test('server UI archive is a deterministic reusable gzip tar with root metadata and arbitrary generated paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminay-server-ui-archive-'))
  const renderer = join(root, 'renderer')
  const publicDirectory = join(root, 'public')
  await mkdir(join(renderer, 'generated', 'chunk'), { recursive: true })
  await mkdir(publicDirectory)
  await writeFile(join(renderer, 'generated', 'chunk', 'launch-page.html'), '<script src="runtime/opaque-name.js"></script>')
  await mkdir(join(renderer, 'generated', 'chunk', 'runtime'))
  await writeFile(join(renderer, 'generated', 'chunk', 'runtime', 'opaque-name.js'), 'window.archiveFixture = true')
  await writeFile(join(renderer, 'generated', 'source.map'), 'not transferred')
  await writeFile(join(publicDirectory, 'unrelated-but-bundled.svg'), '<svg/>')

  const input = {
    entryPath: 'generated/chunk/launch-page.html',
    protocolVersion: '1',
    publicDirectory,
    rendererDirectory: renderer,
  }
  const first = await buildServerUiArchive(input)
  const second = await buildServerUiArchive(input)
  assert.equal(first.archiveFormatVersion, 1)
  assert.equal(first.compressedBytes, first.bytes.byteLength)
  assert.equal(first.bundleId, second.bundleId)
  assert.deepEqual(first.bytes, second.bytes)

  const entries = readTar(gunzipSync(first.bytes))
  assert.deepEqual(entries.map((entry) => entry.path), [
    'terminay-bundle.json',
    'generated/chunk/launch-page.html',
    'generated/chunk/runtime/opaque-name.js',
    'unrelated-but-bundled.svg',
  ])
  assert.equal(entries.every((entry) => entry.type === '0'), true)
  assert.deepEqual(JSON.parse(entries[0].bytes.toString('utf8')), {
    applicationProtocolVersion: '1',
    archiveFormatVersion: 1,
    bundleId: first.bundleId,
    entryPath: 'generated/chunk/launch-page.html',
  })

  await writeFile(join(renderer, 'generated', 'chunk', 'runtime', 'opaque-name.js'), 'mutated after first transfer')
  const immutable = readTar(gunzipSync(first.bytes))
  assert.equal(immutable.find((entry) => entry.path.endsWith('.js')).bytes.toString('utf8'), 'window.archiveFixture = true')
})

test('server UI archive rejects unsafe entry paths and a missing declared entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminay-server-ui-archive-invalid-'))
  await writeFile(join(root, 'server.html'), '<!doctype html>')
  await assert.rejects(
    buildServerUiArchive({ entryPath: '../server.html', protocolVersion: '1', rendererDirectory: root }),
    /entry path/u,
  )
  await assert.rejects(
    buildServerUiArchive({ entryPath: 'nested/entry.html', protocolVersion: '1', rendererDirectory: root }),
    /missing/u,
  )
})

function readTar(bytes) {
  const entries = []
  let offset = 0
  while (offset + 512 <= bytes.byteLength) {
    const header = bytes.subarray(offset, offset + 512)
    offset += 512
    if (header.every((byte) => byte === 0)) break
    const name = tarText(header.subarray(0, 100))
    const prefix = tarText(header.subarray(345, 500))
    const size = Number.parseInt(tarText(header.subarray(124, 136)).trim() || '0', 8)
    const type = String.fromCharCode(header[156])
    entries.push({
      bytes: Buffer.from(bytes.subarray(offset, offset + size)),
      path: prefix ? `${prefix}/${name}` : name,
      type,
    })
    offset += Math.ceil(size / 512) * 512
  }
  return entries
}

function tarText(bytes) {
  const end = bytes.indexOf(0)
  return Buffer.from(end < 0 ? bytes : bytes.subarray(0, end)).toString('utf8')
}

async function importArchiveBuilder() {
  const root = await mkdtemp(join(tmpdir(), 'terminay-server-ui-archive-build-'))
  const outputPath = join(root, 'serverUiArchive.mjs')
  await build({
    bundle: true,
    entryPoints: [new URL('../electron/remote/serverUiArchive.ts', import.meta.url).pathname],
    format: 'esm',
    outfile: outputPath,
    platform: 'node',
    target: 'node24',
  })
  return import(outputPath)
}
