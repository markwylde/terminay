import assert from 'node:assert/strict'
import test from 'node:test'
import { PROVIDER_OUTAGE_PROFILE, runProviderOutageProbe } from './task20-provider-outage.mjs'

test('provider outages retry within a fixed bound, recover freshly, and release every resource', () => {
  const result = runProviderOutageProbe()

  assert.deepEqual(result.providers, {
    codex: { attempts: 3, failures: 2, recovered: true, recoveryResource: 'resource-3' },
    'claude-code': { attempts: 2, failures: 1, recovered: true, recoveryResource: 'resource-5' },
  })
  assert.deepEqual(
    {
      providerCount: result.providerCount,
      resourcesAllocated: result.resourcesAllocated,
      resourcesClosed: result.resourcesClosed,
      openResources: result.openResources,
      peakOpenResources: result.peakOpenResources,
    },
    { providerCount: 2, resourcesAllocated: 5, resourcesClosed: 5, openResources: 0, peakOpenResources: 1 },
  )

  const closed = result.events.filter((event) => event.type === 'resource-closed')
  assert.deepEqual(closed.map(({ resource, reason }) => ({ resource, reason })), [
    { resource: 'resource-1', reason: 'outage' },
    { resource: 'resource-2', reason: 'outage' },
    { resource: 'resource-3', reason: 'shutdown' },
    { resource: 'resource-4', reason: 'outage' },
    { resource: 'resource-5', reason: 'shutdown' },
  ])
  assert.equal(new Set(closed.map((event) => event.resource)).size, closed.length, 'each provider resource is cleaned up exactly once')
})

test('the virtual outage probe is repeatable and rejects profiles that cannot recover', () => {
  assert.deepEqual(runProviderOutageProbe(), runProviderOutageProbe())
  assert.throws(
    () => runProviderOutageProbe({
      ...PROVIDER_OUTAGE_PROFILE,
      providers: [{ name: 'codex', outagesBeforeRecovery: 3 }],
    }),
    /must leave one recovery attempt/u,
  )
})
