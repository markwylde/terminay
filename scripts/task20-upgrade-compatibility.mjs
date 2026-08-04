import { createHash } from 'node:crypto'

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u

export class UpgradeCompatibilityError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'UpgradeCompatibilityError'
    this.code = code
  }
}

/**
 * Construct the small, persisted portion of an update record.  Deliberately
 * excludes credentials and mutable workspace payloads: an updater must not
 * need either to decide whether a recovered installation remains compatible.
 */
export function createInstallation({ artifactVersion, dataSchema, serverId, uiProtocol }) {
  assertVersion(artifactVersion, 'artifact-version-invalid')
  assertInteger(dataSchema, 'data-schema-invalid')
  assertIdentifier(serverId, 'server-id-invalid')
  assertInteger(uiProtocol, 'ui-protocol-invalid')
  return Object.freeze({ artifactVersion, dataSchema, serverId, uiProtocol })
}

export function createUpgradeCandidate({ artifactVersion, dataSchema, migration, uiProtocol }) {
  assertVersion(artifactVersion, 'candidate-version-invalid')
  assertInteger(dataSchema, 'candidate-schema-invalid')
  assertInteger(uiProtocol, 'candidate-protocol-invalid')
  if (!['none', 'forward-compatible'].includes(migration)) {
    throw new UpgradeCompatibilityError('migration-invalid', 'candidate migration must be none or forward-compatible')
  }
  return Object.freeze({ artifactVersion, dataSchema, migration, uiProtocol })
}

/**
 * Decide whether an update can replace the active artifact without changing
 * the server identity or making a prior data revision unreadable.  A failed
 * decision returns the original installation by identity, modelling atomic
 * recovery rather than a half-written state.
 */
export function applyCompatibleUpgrade(installation, candidate) {
  if (candidate.uiProtocol !== installation.uiProtocol) {
    return recovery(installation, 'ui-protocol-incompatible')
  }
  if (candidate.dataSchema < installation.dataSchema) {
    return recovery(installation, 'data-schema-downgrade')
  }
  if (candidate.dataSchema > installation.dataSchema && candidate.migration !== 'forward-compatible') {
    return recovery(installation, 'migration-not-recoverable')
  }
  if (compareVersions(candidate.artifactVersion, installation.artifactVersion) <= 0) {
    return recovery(installation, 'not-a-newer-artifact')
  }
  return Object.freeze({
    action: 'activated',
    installation: Object.freeze({
      artifactVersion: candidate.artifactVersion,
      dataSchema: candidate.dataSchema,
      serverId: installation.serverId,
      uiProtocol: installation.uiProtocol,
    }),
    receipt: receiptFor(installation, candidate),
  })
}

function recovery(installation, reason) {
  return Object.freeze({ action: 'recovered-active', installation, reason })
}

function receiptFor(installation, candidate) {
  const stable = JSON.stringify({
    from: installation.artifactVersion,
    schema: candidate.dataSchema,
    serverId: installation.serverId,
    to: candidate.artifactVersion,
  })
  return createHash('sha256').update(stable).digest('hex')
}

function assertVersion(value, code) {
  if (typeof value !== 'string' || !VERSION.test(value)) {
    throw new UpgradeCompatibilityError(code, 'version must be a semantic version')
  }
}

function assertInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new UpgradeCompatibilityError(code, 'value must be a positive safe integer')
  }
}

function assertIdentifier(value, code) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/u.test(value)) {
    throw new UpgradeCompatibilityError(code, 'server identity is invalid')
  }
}

function compareVersions(left, right) {
  const [leftCore] = left.split(/[-+]/u)
  const [rightCore] = right.split(/[-+]/u)
  const leftParts = leftCore.split('.').map(Number)
  const rightParts = rightCore.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index]
  }
  return left.localeCompare(right)
}
