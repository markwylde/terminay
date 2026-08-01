const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/u
const ID = /^[a-z][a-z0-9._-]{0,63}$/u

export const HOSTED_COMPONENTS = Object.freeze(["bootstrap", "signaling"])

export class HostedDeploymentOrderError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "HostedDeploymentOrderError"
    this.code = code
  }
}

/**
 * Create a release-order model for the separately deployed hosted boundary.
 * This is deliberately a local plan: it validates the compatibility window
 * and dependency order without claiming that a hosted deployment occurred.
 */
export function createHostedDeploymentPlan({ currentHosted, nextHosted, currentClients, dependentClients }) {
  const current = validateHostedRelease(currentHosted, "current hosted release")
  const next = validateHostedRelease(nextHosted, "next hosted release")
  if (compareVersions(next.version, current.version) <= 0) throw new HostedDeploymentOrderError("hosted-version-regression", "next hosted release must be newer than the current release")

  const deployed = validateClients(currentClients, "currently deployed clients")
  const dependents = validateClients(dependentClients, "dependent client releases")
  if (deployed.length === 0) throw new HostedDeploymentOrderError("missing-current-clients", "at least one deployed client is required to prove backward compatibility")
  if (dependents.length === 0) throw new HostedDeploymentOrderError("missing-dependent-clients", "at least one dependent client release is required to prove deployment ordering")
  if (new Set(dependents.map((client) => client.id)).size !== dependents.length) throw new HostedDeploymentOrderError("duplicate-client", "dependent client ids must be unique")

  for (const client of deployed) {
    if (!withinRange(client.version, current)) throw new HostedDeploymentOrderError("current-hosted-incompatible", `currently deployed client ${client.id} version ${client.version} is outside the current hosted compatibility window`)
  }
  for (const client of [...deployed, ...dependents]) {
    if (!withinRange(client.version, next)) {
      const category = deployed.includes(client) ? "currently deployed" : "dependent"
      throw new HostedDeploymentOrderError("hosted-not-backward-compatible", `${category} client ${client.id} version ${client.version} is outside the next hosted compatibility window`)
    }
  }

  const clientStages = dependents.map((client) => Object.freeze({
    id: `client:${client.id}`,
    kind: "dependent-client",
    dependsOn: Object.freeze(["verify-hosted"]),
    client: Object.freeze({ ...client }),
  }))
  const stages = Object.freeze([
    Object.freeze({ id: "publish-hosted", kind: "hosted", dependsOn: Object.freeze([]), components: HOSTED_COMPONENTS }),
    Object.freeze({ id: "verify-hosted", kind: "hosted-verification", dependsOn: Object.freeze(["publish-hosted"]), components: HOSTED_COMPONENTS }),
    ...clientStages,
    Object.freeze({ id: "retire-previous-hosted", kind: "hosted-retirement", dependsOn: Object.freeze(clientStages.map((stage) => stage.id)), components: HOSTED_COMPONENTS }),
  ])

  return Object.freeze({
    schemaVersion: 1,
    currentHosted: Object.freeze({ ...current }),
    nextHosted: Object.freeze({ ...next }),
    compatibility: Object.freeze({
      hostedComponents: HOSTED_COMPONENTS,
      currentClients: Object.freeze(deployed.map((client) => Object.freeze({ ...client }))),
      dependentClients: Object.freeze(dependents.map((client) => Object.freeze({ ...client }))),
      currentClientsCovered: true,
    }),
    stages,
  })
}

/**
 * Validate an execution trace against the plan's dependency graph. CI and a
 * deployment tool can use this guard without trusting a hand-written order.
 */
export function assertHostedDeploymentOrder(plan, execution) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.stages)) throw new HostedDeploymentOrderError("invalid-plan", "hosted deployment plan is invalid")
  if (!Array.isArray(execution) || execution.some((id) => typeof id !== "string")) throw new HostedDeploymentOrderError("invalid-order", "hosted deployment execution must contain stage ids")
  const expected = plan.stages.map((stage) => stage.id)
  if (execution.length !== expected.length || new Set(execution).size !== execution.length || execution.some((id) => !expected.includes(id))) throw new HostedDeploymentOrderError("invalid-order", "hosted deployment execution must contain each planned stage exactly once")
  const positions = new Map(execution.map((id, index) => [id, index]))
  for (const stage of plan.stages) {
    const position = positions.get(stage.id)
    for (const dependency of stage.dependsOn) {
      if (position === undefined || (positions.get(dependency) ?? Number.POSITIVE_INFINITY) >= position) throw new HostedDeploymentOrderError("invalid-order", `${stage.id} must run after ${dependency}`)
    }
  }
  return true
}

function validateHostedRelease(value, label) {
  if (!value || typeof value !== "object" || !isVersion(value.version) || !isVersion(value.minimumClientVersion) || !isVersion(value.maximumClientVersion)) throw new HostedDeploymentOrderError("invalid-hosted-release", `${label} must declare hosted and client versions`)
  if (compareVersions(value.minimumClientVersion, value.maximumClientVersion) > 0) throw new HostedDeploymentOrderError("invalid-hosted-release", `${label} client compatibility range is invalid`)
  return { version: value.version, minimumClientVersion: value.minimumClientVersion, maximumClientVersion: value.maximumClientVersion }
}

function validateClients(value, label) {
  if (!Array.isArray(value) || value.some((client) => !client || typeof client !== "object" || !isId(client.id) || !isVersion(client.version))) throw new HostedDeploymentOrderError("invalid-client-release", `${label} must contain id and semantic version`)
  return value.map((client) => ({ id: client.id, version: client.version }))
}

function withinRange(version, hosted) {
  return compareVersions(version, hosted.minimumClientVersion) >= 0 && compareVersions(version, hosted.maximumClientVersion) <= 0
}

function isId(value) { return typeof value === "string" && ID.test(value) }
function isVersion(value) { return typeof value === "string" && SEMVER.test(value) }

function compareVersions(left, right) {
  const leftParts = left.match(SEMVER)
  const rightParts = right.match(SEMVER)
  if (leftParts === null || rightParts === null) throw new HostedDeploymentOrderError("invalid-version", "versions must be semantic versions")
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(leftParts[index]) - Number(rightParts[index])
    if (difference !== 0) return difference
  }
  return 0
}
