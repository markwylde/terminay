import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { inspectStandaloneArtifact, validateStandaloneArtifact, writeStandaloneArtifactManifest } from './standalone-artifact.mjs'

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'terminay-standalone-artifact-'))
  await mkdir(join(root, 'dist'))
  await writeFile(join(root, 'package.json'), `${JSON.stringify({
    name: '@terminay/server',
    version: '1.2.3',
    files: ['dist'],
    engines: { node: '22.23.1' },
    bin: { 'terminay-server': 'dist/cli.js', 'terminay-mcp': 'dist/mcpEntry.js' },
  })}\n`)
  await writeFile(join(root, 'dist/cli.js'), '#!/usr/bin/env node\nconsole.log("ready")\n')
  await writeFile(join(root, 'dist/index.js'), 'export const serverApplicationBoundary = "@terminay/server"\n')
  await writeFile(join(root, 'dist/mcpEntry.js'), 'export const mcpEntry = true\n')
  return root
}

test('standalone artifact manifest is deterministic and validates exact payload hashes', async () => {
  const root = await createFixture()
  try {
    const first = await inspectStandaloneArtifact(root)
    const second = await inspectStandaloneArtifact(root)
    assert.deepEqual(first, second)
    const manifestPath = join(root, 'artifact-manifest.json')
    const written = await writeStandaloneArtifactManifest(root, manifestPath)
    assert.deepEqual(written, first)
    const onDisk = JSON.parse(await readFile(manifestPath, 'utf8'))
    assert.deepEqual(onDisk, first)
    assert.deepEqual(await validateStandaloneArtifact(root, onDisk), first)
    assert.equal(first.provenance.generatedBy, 'scripts/standalone-artifact.mjs')
    assert.equal(first.files.length, 4)
    assert.ok(first.files.every((file) => /^[a-f0-9]{64}$/u.test(file.sha256)))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('standalone artifact validation detects payload tampering', async () => {
  const root = await createFixture()
  try {
    const manifest = await writeStandaloneArtifactManifest(root)
    await writeFile(join(root, 'dist/cli.js'), '#!/usr/bin/env node\nconsole.log("changed")\n')
    await assert.rejects(() => validateStandaloneArtifact(root, manifest), /hashes do not match/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('standalone artifact inspection rejects Electron imports and unpinned Node engines', async () => {
  const root = await createFixture()
  try {
    await writeFile(join(root, 'dist/index.js'), 'import electron from "electron"\nexport default electron\n')
    await assert.rejects(() => inspectStandaloneArtifact(root), /imports Electron/)
    await writeFile(join(root, 'dist/index.js'), 'export const ok = true\n')
    const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    packageJson.engines.node = '>=22'
    await writeFile(join(root, 'package.json'), `${JSON.stringify(packageJson)}\n`)
    await assert.rejects(() => inspectStandaloneArtifact(root), /Node engine must be pinned/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
