import assert from 'node:assert/strict'
import { builtinModules, createRequire } from 'node:module'
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'

const serverRoot = fileURLToPath(new URL('..', import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const standaloneEntrypoints = [
  join(serverRoot, 'dist/cli.js'),
  join(serverRoot, 'dist/index.js'),
  join(serverRoot, 'dist/mcpEntry.js'),
]
const javascriptModule = /\.(?:[cm]?js)$/u
const importPatterns = [
  /\b(?:import|export)\s+(?:[^"']*?\s+from\s*)?["']([^"']+)["']/gu,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/gu,
]
const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])
const optionalPeerDependencies = new Set(['bufferutil', 'utf-8-validate'])

function moduleSpecifiers(source) {
  const executableSource = source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\/\/.*$/gmu, '')
  const specifiers = new Set()
  for (const pattern of importPatterns) {
    for (const match of executableSource.matchAll(pattern)) specifiers.add(match[1])
  }
  return [...specifiers]
}

async function standaloneRuntimeGraph(entrypoints) {
  const visited = new Set()
  const queue = [...entrypoints]
  while (queue.length > 0) {
    const candidate = queue.pop()
    const modulePath = await realpath(candidate)
    if (visited.has(modulePath)) continue
    visited.add(modulePath)
    if (!javascriptModule.test(modulePath) || !(await stat(modulePath)).isFile()) continue

    const source = await readFile(modulePath, 'utf8')
    for (const specifier of moduleSpecifiers(source)) {
      assert.notEqual(
        specifier === 'electron' || specifier.startsWith('electron/'),
        true,
        `Electron import in standalone runtime module ${relative(repositoryRoot, modulePath)}`,
      )
      if (builtins.has(specifier)) continue
      const resolver = createRequire(modulePath)
      let resolved
      try {
        resolved = resolver.resolve(specifier)
      } catch (error) {
        if (!specifier.startsWith('.')) {
          if (optionalPeerDependencies.has(specifier)) continue
          assert.fail(`unable to resolve standalone runtime dependency ${specifier} from ${relative(repositoryRoot, modulePath)}: ${error.message}`)
        }
        const esmCandidate = join(dirname(modulePath), `${specifier}.js`)
        const candidateInfo = await stat(esmCandidate).catch(() => undefined)
        assert.ok(candidateInfo?.isFile(), `unable to resolve standalone runtime dependency ${specifier} from ${relative(repositoryRoot, modulePath)}`)
        resolved = esmCandidate
      }
      queue.push(resolved)
    }
  }
  return [...visited].sort()
}

test('standalone runtime dependency graph has no Electron imports', async () => {
  const modules = await standaloneRuntimeGraph(standaloneEntrypoints)
  assert.ok(modules.length > 0, 'expected built standalone runtime modules')
  assert.ok(modules.some((modulePath) => modulePath.includes('/packages/server-core/dist/')), 'expected server-core in standalone runtime graph')
  assert.ok(modules.some((modulePath) => modulePath.includes('/packages/protocol/dist/')), 'expected protocol in standalone runtime graph')
})

test('standalone runtime graph rejects direct, dynamic, and CommonJS Electron imports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminay-standalone-runtime-graph-'))
  try {
    for (const [index, source] of [
      'import { app } from "electron"\n',
      'export const load = () => import("electron")\n',
      'const electron = require("electron")\n',
    ].entries()) {
      const entrypoint = join(root, `fixture-${index}.js`)
      await writeFile(entrypoint, source)
      await assert.rejects(() => standaloneRuntimeGraph([entrypoint]), /Electron import in standalone runtime module/)
    }
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
