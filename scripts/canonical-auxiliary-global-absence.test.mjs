import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const forbidden = /terminay(?:EditWindow|QuickPush|ProjectEdit|TerminalEdit|Recordings)Host/u

test('canonical production graph contains no auxiliary compatibility globals', async () => {
  const paths = [
    'src/App.tsx',
    'src/shared/auxiliaryRoutes.tsx',
    'src/shared/ConnectedRendererWorkspace.tsx',
    'src/vite-env.d.ts',
    'electron/main.ts',
  ]
  for (const path of paths) assert.doesNotMatch(await readFile(path, 'utf8'), forbidden, path)
  for (const path of [
    'src/components/EditTabWindow.tsx',
    'src/components/QuickPushModal.tsx',
    'electron/quickPush/ipc.ts',
    'electron/quickPush/service.ts',
  ]) await assert.rejects(access(path), { code: 'ENOENT' })
})

test('recording and tab-edit requests always use the canonical presenter', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'terminay-auxiliary-route-'))
  const output = join(directory, 'auxiliary.mjs')
  try {
    await build({ bundle: true, entryPoints: ['src/shared/auxiliaryRoutes.tsx'], format: 'esm', outfile: output, platform: 'node', logLevel: 'silent' })
    const { createAuxiliaryRouteController } = await import(pathToFileURL(output).href)
    const requests = []
    const controller = createAuxiliaryRouteController({ onRequest: async (request) => {
      requests.push(request)
      return request.kind === 'edit-tab' ? { title: 'Updated' } : undefined
    } })
    await controller.openRecordings()
    assert.deepEqual(await controller.editProjectTab({ kind: 'project', projectId: 'p1', draft: { title: 'Project' } }), { title: 'Updated' })
    assert.deepEqual(await controller.editTerminalTab({ kind: 'terminal', projectId: 'p1', sessionId: 's1', draft: { title: 'Terminal' } }), { title: 'Updated' })
    assert.deepEqual(requests.map(({ kind }) => kind), ['recordings', 'edit-tab', 'edit-tab'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
