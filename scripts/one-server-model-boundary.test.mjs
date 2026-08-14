import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { auditOneServerModel } from './one-server-model-boundary.mjs'

test('connected renderer authority boundary remains at the exact-zero baseline', async () => {
  const baseline = JSON.parse(await readFile('scripts/one-server-model-boundary-baseline.json', 'utf8'))
  assert.deepEqual(baseline, [], 'the retired authority baseline must remain empty')
  const current = await auditOneServerModel()
  assert.deepEqual(current, [], `connected renderer authority violations:\n${JSON.stringify(current, null, 2)}`)
})

test('audit distinguishes canonical clients and presentation hosts without compatibility exemptions', async () => {
  const root = await mkdtemp(join(process.cwd(), '.one-server-boundary-'))
  test.after(async () => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'src/components'), { recursive: true })
  await mkdir(join(root, 'src/services'), { recursive: true })
  await mkdir(join(root, 'src/services/example'), { recursive: true })
  await writeFile(join(root, 'src/App.tsx'), `
    window.terminayRevealHost?.reveal("file")
    window.terminayFileExplorerHost?.watchDirectory("file")
  `)
  await writeFile(join(root, 'src/components/Panel.tsx'), `
    const client = createLegacyFileViewerClient()
    window.terminayFileExplorerHost?.resolveDroppedFilePath(file)
  `)
  await writeFile(join(root, 'src/services/example/legacyCompatibility.ts'), `
    window.terminayGitHost?.status()
    const gateway = terminayFileGateway
  `)
  const violations = await auditOneServerModel(root)
  assert.deepEqual(violations.map(({ path, line, symbol }) => ({ path, line, symbol })), [
    { path: 'src/App.tsx', line: 3, symbol: 'terminayFileExplorerHost' },
    { path: 'src/components/Panel.tsx', line: 2, symbol: 'createLegacyFileViewerClient' },
	{ path: 'src/components/Panel.tsx', line: 3, symbol: 'terminayFileExplorerHost' },
  ])
})
