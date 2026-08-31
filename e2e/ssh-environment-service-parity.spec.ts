import { test, expect } from '@playwright/test'
import { ExtensionProjectEnvironmentRuntime } from '../packages/server-core/dist/extensions/projectEnvironmentRuntime.js'

type ProviderCall = { readonly request: unknown }
type ObservationResult = Readonly<{ state?: string; protocol?: string; version?: number; reason?: string }>

/** A provider request crosses the extension boundary as untrusted JSON. */
function field(call: ProviderCall, key: string): unknown {
  const request = call.request
  if (typeof request !== 'object' || request === null || Array.isArray(request)) return undefined
  return (request as Record<string, unknown>)[key]
}

const providerId = 'com.terminay.ssh/connection'
const capabilities = ['terminal', 'process-observation'] as const

function environment(id: string, revision: number, providerState: Record<string, unknown>) {
  return {
    id, providerId, profileId: `profile-${id}`, pinnedRevision: revision,
    name: id, endpointSummary: 'ssh fixture', defaultRoot: '/work',
    declaredCapabilities: [...capabilities], availableCapabilities: [...capabilities],
    status: 'ready' as const, operationReferences: [], projectReferenceCount: 1,
    archived: false, builtIn: false, providerState, providerRevision: 1,
  }
}

function context(id: string, revision: number) {
  return { serverId: 'server-e2e', projectId: `project-${id}`, projectEnvironmentId: id, environmentRevision: revision, deadline: Date.now() + 10_000, signal: new AbortController().signal }
}

test('Docker: generic SSH and composed Puzed projects keep exact provider bindings', async () => {
  const ssh = environment('ssh-env', 4, { profile: 'generic' })
  const puzed = environment('puzed-env', 9, { sshBindingId: 'puzed-ssh:machine-1' })
  const state = { schemaVersion: 2, serverId: 'server-e2e', revision: 1, cursor: '1', profiles: {}, operations: {}, environments: { [ssh.id]: ssh, [puzed.id]: puzed } }
  const calls: ProviderCall[] = []
  const runtime = new ExtensionProjectEnvironmentRuntime(providerId, capabilities, { async invokeProvider(call: ProviderCall) { calls.push(call); return { accepted: true } } }, () => state)

  await runtime.invoke('terminal', 'input', { sessionId: 'generic-session', data: 'a' }, context(ssh.id, 4))
  await runtime.invoke('terminal', 'input', { sessionId: 'puzed-session', data: 'b' }, context(puzed.id, 9))
  expect(calls.map(call => [field(call, 'environmentId'), field(call, 'providerState')])).toEqual([
    ['ssh-env', { profile: 'generic' }],
    ['puzed-env', { sshBindingId: 'puzed-ssh:machine-1' }],
  ])
  await expect(runtime.invoke('terminal', 'input', { sessionId: 'cross', data: 'x' }, context(puzed.id, 4))).rejects.toThrow(/binding changed/)
})

test('Docker: helper absent, incompatible, crashed and upgraded stay explicit and fail closed', async () => {
  let current = environment('ssh-env', 4, { profile: 'generic' })
  let state = { schemaVersion: 2, serverId: 'server-e2e', revision: 1, cursor: '1', profiles: {}, operations: {}, environments: { [current.id]: current } }
  let helper: 'absent' | 'incompatible' | 'available' | 'crashed' = 'absent'
  const runtime = new ExtensionProjectEnvironmentRuntime(providerId, capabilities, { async invokeProvider(call: ProviderCall) {
    if (field(call, 'capability') !== 'process-observation') return { accepted: true }
    if (field(call, 'operation') === 'observe') return helper === 'available'
      ? { observationId: 'proof-bound', protocol: 'terminay-target-helper/process-v1', version: 1, state: 'starting' }
      : { observationId: `helper-${helper}`, protocol: 'terminay-target-helper/process-v1', version: 1, state: 'unavailable', reason: helper }
    if (field(call, 'operation') === 'poll') return helper === 'available'
      ? { observationId: 'proof-bound', state: 'available', cwd: '/work', foregroundProcess: 'codex', observedAt: Date.now() }
      : { observationId: `helper-${helper}`, state: 'unavailable', cwd: null, foregroundProcess: null, reason: helper }
    return { observationId: String(field(call, 'input').observationId), stopped: true }
  } }, () => state)

  for (const unavailable of ['absent', 'incompatible', 'crashed'] as const) {
    helper = unavailable
    const result = (await runtime.invoke('process-observation', 'observe', { sessionId: 'exact-session' }, context(current.id, 4))) as ObservationResult
    expect(result).toMatchObject({ state: 'unavailable', reason: unavailable })
  }
  helper = 'available'
  const started = (await runtime.invoke('process-observation', 'observe', { sessionId: 'exact-session' }, context(current.id, 4))) as ObservationResult
  expect(started).toMatchObject({ protocol: 'terminay-target-helper/process-v1', version: 1, state: 'starting' })

  current = environment('ssh-env', 5, { profile: 'generic', helperVersion: 2 })
  state = { ...state, revision: 2, environments: { [current.id]: current } }
  await expect(runtime.invoke('process-observation', 'poll', { observationId: 'proof-bound', sessionId: 'exact-session' }, context(current.id, 4))).rejects.toThrow(/binding changed/)
  const upgraded = (await runtime.invoke('process-observation', 'observe', { sessionId: 'new-exact-session' }, context(current.id, 5))) as ObservationResult
  expect(upgraded.state).toBe('starting')
})
