import assert from 'node:assert/strict'
import test from 'node:test'
import { ShellProfilesClient } from '../dist/shellProfiles.js'
import { WorkspaceClient } from '../dist/workspace.js'

const system = {
  id: 'system', name: 'System default', target: { kind: 'system' }, args: [], startupMode: 'default',
  kind: 'system', readOnly: true, source: 'account', availability: { available: true }, projectReferences: [], argumentCount: 0, environmentEntryCount: 0, hasEnvironmentOverlay: false,
}
const catalogue = { settingsRevision: 3, entries: [system], defaultProfileId: 'system', cwdPolicy: 'current' }

test('shell profile client keeps profile records structured and revisioned', async () => {
  const calls = []
  const transport = {
    query: async (operation, payload) => { calls.push({ operation, payload }); return catalogue },
    command: async (operation, payload, options) => { calls.push({ operation, payload, options }); return { ...catalogue, settingsRevision: 4 } },
  }
  const client = new ShellProfilesClient(transport)
  assert.deepEqual(await client.catalogue(), catalogue)
  await client.create({
    name: 'Test', target: { kind: 'executable', executable: '/bin/zsh' },
    args: ['--no-rcs'], startupMode: 'login', environment: { REMOVE_ME: null, VALUE: 'literal value' },
  }, { expectedRevision: 3 })
  assert.deepEqual(calls[1], {
    operation: 'shell-profiles.create',
    payload: { profile: { name: 'Test', target: { kind: 'executable', executable: '/bin/zsh' }, args: ['--no-rcs'], startupMode: 'login', environment: { REMOVE_ME: null, VALUE: 'literal value' } } },
    options: { expectedRevision: 3 },
  })
})

test('shell profile client enforces bounded argument and environment collections', async () => {
  const client = new ShellProfilesClient({ query: async () => catalogue, command: async () => catalogue })
  const base = { name: 'Test', target: { kind: 'executable', executable: '/bin/zsh' }, startupMode: 'default' }
  await assert.rejects(() => client.create({ ...base, args: Array(65).fill('x'), environment: {} }), /arguments exceed/)
  await assert.rejects(() => client.create({ ...base, args: [], environment: Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`KEY_${index}`, 'x'])) }), /environment exceeds/)
})

test('shell profile catalogue rejects an unknown default identity', async () => {
  const client = new ShellProfilesClient({ query: async () => ({ ...catalogue, defaultProfileId: 'missing' }), command: async () => catalogue })
  await assert.rejects(() => client.catalogue(), /default is invalid/)
})

test('profile detail is a separate write-scoped query and preserves null removals', async () => {
  const calls = []
  const detail = { id: 'profile:test', name: 'Test', target: { kind: 'executable', executable: '/bin/zsh' }, args: [], startupMode: 'default', environment: { REMOVE_ME: null } }
  const client = new ShellProfilesClient({ query: async (operation, payload) => { calls.push({ operation, payload }); return detail }, command: async () => catalogue })
  assert.deepEqual(await client.detail('profile:test'), detail)
  assert.deepEqual(calls, [{ operation: 'shell-profiles.detail', payload: { profileId: 'profile:test' } }])
})

test('validation issues are exposed by field without losing the bounded issue list', async () => {
  const validation = { valid: false, issues: [{ code: 'invalid-executable', field: 'target.executable', message: 'Executable is unavailable.' }] }
  const client = new ShellProfilesClient({ query: async () => validation, command: async () => catalogue })
  const result = await client.validate({ id: 'profile:test', name: 'Test', target: { kind: 'executable', executable: '/missing' }, args: [], startupMode: 'default', environment: {} })
  assert.equal(result.fieldErrors['target.executable'], 'Executable is unavailable.')
  assert.deepEqual(result.issues, validation.issues)
})

test('project shell defaults use the lowercase named operations', async () => {
  const calls = []
  const client = new WorkspaceClient({ command: async (operation, payload) => { calls.push({ operation, payload }); return { result: { revision: calls.length, cursor: String(calls.length) } } } })
  await client.setProjectShellProfile({ projectId: 'project:one', profileId: 'profile:one' })
  await client.setProjectShellProfile({ projectId: 'project:one' })
  assert.deepEqual(calls, [
    { operation: 'project.shell-profile.set', payload: { projectId: 'project:one', profileId: 'profile:one' } },
    { operation: 'project.shell-profile.clear', payload: { projectId: 'project:one' } },
  ])
})
