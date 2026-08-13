import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { build } from 'esbuild'
import { join } from 'node:path'
import test from 'node:test'

const directory = await mkdtemp(join(process.cwd(), '.project-terminal-context-'))
const bundle = join(directory, 'context.mjs')
await build({ entryPoints: ['src/shared/projectTerminalClientContext.ts'], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'silent' })
const { composeProjectTerminalClientContext } = await import(`${bundle}?test=${Date.now()}`)
test.after(() => rm(directory, { force: true, recursive: true }))

test('project context never mixes replacement hydration with retired authority', () => {
  const old = { applicationClient: { state: 'closed', generation: 1 }, client: { generation: 1 }, clientId: 'old', serverId: 'server', reportConnectionHydrated: () => 1 }
  const replacement = { applicationClient: { state: 'connected', generation: 2 }, client: { generation: 2 }, clientId: 'new', serverId: 'server', reportConnectionHydrated: () => 2 }
  const oldProject = composeProjectTerminalClientContext(old, 'project', '/root')
  const next = composeProjectTerminalClientContext(replacement, 'project', '/root')
  assert.equal(oldProject.applicationClient.generation, 1)
  assert.equal(next.applicationClient.generation, 2)
  assert.equal(next.client.generation, 2)
  assert.equal(next.reportConnectionHydrated(), 2)
  assert.notEqual(next.applicationClient, oldProject.applicationClient)
})
