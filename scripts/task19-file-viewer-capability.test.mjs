import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)

test('Task 19 file-viewer capabilities are frozen, explicit, and isolated per provider', async () => {
  const bundleDirectory = await mkdtemp(path.join(os.tmpdir(), 'terminay-task19-file-one-shot-'))
  try {
    await build({
      bundle: true,
      entryPoints: ['src/services/fileViewer/disconnectedFilePanelCompatibility.ts'],
      format: 'cjs',
      logLevel: 'silent',
      outfile: path.join(bundleDirectory, 'gateway.cjs'),
      platform: 'node',
    })
    const { createDisconnectedFilePanelCompatibility } = require(path.join(bundleDirectory, 'gateway.cjs'))
    const calls = []
    const makeApi = () => Object.fromEntries([
      'deleteEntry', 'getFileInfo', 'getFilePreviewSource', 'getGitDiff', 'getGitRepoInfo',
      'getFileTextMetadata', 'listDirectory', 'mkdir', 'onFileWatchEvent', 'readFileBytes', 'readFileText',
      'readFileTextLines', 'renameEntry', 'saveFile', 'saveSparseFile', 'unwatchFile', 'watchFile',
    ].map((name) => [name, (...args) => {
      calls.push([name, args])
      return name === 'onFileWatchEvent' ? () => {} : Promise.resolve(name)
    }]))
    const apiA = makeApi()
    apiA.getFileInfo = async (filePath) => {
      calls.push(['getFileInfo', [filePath]])
      return {
        exists: true, extension: '.md', ino: 1, isDirectory: false,
        isFile: true, isSymbolicLink: false, mtimeMs: 1, revision: 'a',
        name: 'README.md', path: filePath, size: 1,
      }
    }
    const apiB = makeApi()
    apiB.getFileInfo = async (filePath) => ({
      exists: true, extension: '.md', ino: 2, isDirectory: false,
      isFile: true, isSymbolicLink: false, mtimeMs: 2, revision: 'b',
      name: 'README.md', path: filePath, size: 2,
    })
    const compatibilityA = createDisconnectedFilePanelCompatibility(apiA)
    const compatibilityB = createDisconnectedFilePanelCompatibility(apiB)
    apiA.getFileInfo = () => { throw new Error('replacement must not be observed') }
    assert.notEqual(compatibilityA.gateway, compatibilityB.gateway)
    assert.equal((await compatibilityA.getMutationRevision('/workspace/README.md')).mtimeMs, 1)
    assert.equal((await compatibilityB.getMutationRevision('/workspace/README.md')).mtimeMs, 2)
    assert.ok(compatibilityA.createClient())
    assert.ok(compatibilityB.createClient())
  } finally {
    await rm(bundleDirectory, { force: true, recursive: true })
  }
})
