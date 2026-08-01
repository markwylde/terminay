/**
 * Deterministic provider-outage recovery contract.
 *
 * This is deliberately a virtual scheduler rather than a network test.  It
 * makes the reliability invariants reviewable without depending on a real
 * provider, credentials, clocks, retry timers, or the current machine.  Each
 * attempt owns one ephemeral provider resource.  Failed attempts must release
 * theirs before a retry may begin; successful recovery receives a fresh
 * resource and final shutdown releases it too.
 */
export const PROVIDER_OUTAGE_PROFILE = Object.freeze({
  providers: Object.freeze([
    Object.freeze({ name: 'codex', outagesBeforeRecovery: 2 }),
    Object.freeze({ name: 'claude-code', outagesBeforeRecovery: 1 }),
  ]),
  maxAttemptsPerProvider: 3,
})

/**
 * Simulate a bounded outage for each provider and return immutable aggregate
 * evidence.  Nothing here is secret-bearing: resource identifiers are local
 * monotonically increasing test handles, not provider/session identifiers.
 */
export function runProviderOutageProbe(profile = PROVIDER_OUTAGE_PROFILE) {
  validateProfile(profile)

  const resources = new Map()
  const events = []
  const providers = {}
  let nextResource = 0
  let peakOpenResources = 0

  const openResource = (provider, attempt) => {
    const resource = `resource-${++nextResource}`
    resources.set(resource, { provider, attempt, closed: false })
    peakOpenResources = Math.max(peakOpenResources, openResourceCount(resources))
    events.push(Object.freeze({ type: 'attempt-started', provider, attempt, resource }))
    return resource
  }
  const closeResource = (resource, reason) => {
    const value = resources.get(resource)
    if (!value) throw new Error('unknown provider resource')
    if (value.closed) throw new Error('provider resource closed more than once')
    value.closed = true
    events.push(Object.freeze({ type: 'resource-closed', provider: value.provider, attempt: value.attempt, resource, reason }))
  }

  for (const provider of profile.providers) {
    let recoveredResource = null
    let attempts = 0
    let failures = 0
    while (attempts < profile.maxAttemptsPerProvider) {
      attempts += 1
      const resource = openResource(provider.name, attempts)
      if (failures < provider.outagesBeforeRecovery) {
        failures += 1
        events.push(Object.freeze({ type: 'provider-unavailable', provider: provider.name, attempt: attempts }))
        closeResource(resource, 'outage')
        continue
      }
      recoveredResource = resource
      events.push(Object.freeze({ type: 'provider-recovered', provider: provider.name, attempt: attempts, resource }))
      break
    }
    if (!recoveredResource) throw new Error(`provider ${provider.name} did not recover within the fixed retry bound`)

    // Prove the recovered connection owns a new resource and final cleanup is
    // not left to an outage callback that might never arrive.
    closeResource(recoveredResource, 'shutdown')
    providers[provider.name] = Object.freeze({
      attempts,
      failures,
      recovered: true,
      recoveryResource: recoveredResource,
    })
  }

  const closedResources = [...resources.values()].filter((resource) => resource.closed).length
  return deepFreeze({
    providerCount: profile.providers.length,
    resourcesAllocated: resources.size,
    resourcesClosed: closedResources,
    openResources: openResourceCount(resources),
    peakOpenResources,
    providers,
    events,
  })
}

function openResourceCount(resources) {
  let count = 0
  for (const resource of resources.values()) if (!resource.closed) count += 1
  return count
}

function validateProfile(profile) {
  if (!Array.isArray(profile.providers) || profile.providers.length === 0) throw new TypeError('providers must be a non-empty array')
  if (!Number.isInteger(profile.maxAttemptsPerProvider) || profile.maxAttemptsPerProvider < 1) throw new TypeError('maxAttemptsPerProvider must be a positive integer')
  const names = new Set()
  for (const provider of profile.providers) {
    if (!provider || typeof provider.name !== 'string' || !/^[a-z0-9-]{1,64}$/u.test(provider.name)) throw new TypeError('provider name must be a bounded lowercase identifier')
    if (names.has(provider.name)) throw new TypeError('provider names must be unique')
    names.add(provider.name)
    if (!Number.isInteger(provider.outagesBeforeRecovery) || provider.outagesBeforeRecovery < 0) throw new TypeError('outagesBeforeRecovery must be a non-negative integer')
    if (provider.outagesBeforeRecovery >= profile.maxAttemptsPerProvider) throw new RangeError('provider outage count must leave one recovery attempt')
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}
