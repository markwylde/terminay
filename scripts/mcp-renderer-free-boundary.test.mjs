import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

const root = resolve(new URL('..', import.meta.url).pathname)
const serverEntry = join(root, 'apps/terminay-server/src/mcpEntry.ts')
const serverStdio = join(root, 'apps/terminay-server/src/mcp/stdio.ts')
const serverMetadata = join(root, 'apps/terminay-server/src/mcp/compatibility.ts')
const electronMcpIndex = join(root, 'electron/mcp/index.ts')
const electronMain = join(root, 'electron/main.ts')
const electronPreload = join(root, 'electron/preload.ts')
const electronControlProtocol = join(root, 'electron/control/protocol.ts')

test('server MCP metadata identifies the renderer-free authoritative entry', async () => {
  const source = await readFile(serverMetadata, 'utf8')
  assert.match(source, /authority:\s*["']server["']/u)
  assert.match(source, /rendererDependency:\s*false/u)
  assert.match(source, /electronDependency:\s*false/u)
  assert.match(source, /status:\s*["']compatibility-only["']/u)
  assert.match(source, /hostBoundary:\s*["']electron\/main\.ts["']/u)

  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-mcp-boundary-'))
  const bundlePath = join(tempDir, 'server-mcp-stdio.mjs')
  try {
    await build({
      bundle: true,
      entryPoints: [serverStdio],
      format: 'esm',
      outfile: bundlePath,
      platform: 'node',
      target: 'node24',
    })
    const module = await import(bundlePath)
    assert.equal(module.SERVER_MCP_ENTRY.authority, 'server')
    assert.equal(module.SERVER_MCP_ENTRY.rendererDependency, false)
    assert.equal(module.SERVER_MCP_ENTRY.electronDependency, false)
    assert.equal(module.MCP_COMPATIBILITY_METADATA.authoritativeEntry.id, 'terminay-server-mcp')
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('the real server MCP entry bundles without renderer or Electron forwarding dependencies', async () => {
  const [entrySource, stdioSource, electronIndexSource, mainSource, preloadSource, controlProtocolSource] = await Promise.all([
    readFile(serverEntry, 'utf8'),
    readFile(serverStdio, 'utf8'),
    readFile(electronMcpIndex, 'utf8'),
    readFile(electronMain, 'utf8'),
    readFile(electronPreload, 'utf8'),
    readFile(electronControlProtocol, 'utf8'),
  ])
  assert.match(entrySource, /runServerMcpStdio/u)
  assert.doesNotMatch(entrySource, /electron\/mcp|src\/App|CONTROL_REQUEST_CHANNEL|control:request/u)
  assert.doesNotMatch(stdioSource, /(?:from|require\()\s*["']electron(?:\/|["'])/u)
  assert.doesNotMatch(stdioSource, /CONTROL_REQUEST_CHANNEL|control:request|src\/App\.tsx/u)
  assert.match(electronIndexSource, /compatibility-only/u)
  assert.doesNotMatch(mainSource, /CONTROL_REQUEST_CHANNEL|CONTROL_RESPONSE_CHANNEL|control:request/u)
  assert.doesNotMatch(preloadSource, /onControlRequest|sendControlResponse|control:request/u)
  assert.doesNotMatch(controlProtocolSource, /ControlRendererRequest|ControlRendererResponse|control:request/u)

  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-mcp-entry-bundle-'))
  const bundlePath = join(tempDir, 'mcp-entry.mjs')
  try {
    await build({
      bundle: true,
      entryPoints: [serverEntry],
      format: 'esm',
      outfile: bundlePath,
      platform: 'node',
      target: 'node24',
    })
    const bundle = await readFile(bundlePath, 'utf8')
    assert.doesNotMatch(bundle, /(?:from|require\()\s*["']electron(?:\/|["'])/u)
    assert.doesNotMatch(bundle, /CONTROL_REQUEST_CHANNEL|control:request|src\/App\.tsx/u)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})
