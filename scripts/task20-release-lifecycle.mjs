import { createHash } from 'node:crypto'

export const UPDATE_TARGETS = Object.freeze({
  DESKTOP_HOST: 'desktop-host',
  STANDALONE_SERVER: 'standalone-server',
  REMOTE_SERVER: 'remote-server',
})

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/u

export class ReleaseLifecycleError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ReleaseLifecycleError'
    this.code = code
  }
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Build a release candidate record from verified artifact metadata. This
 * helper accepts hashes and signatures as evidence fields; it does not claim
 * to verify platform signatures or notarization.
 */
export function createCandidate({ artifactId, product, version, protocolVersion, serverVersion, uiVersion, files, entrypoints = [], signature = null }) {
  if (!isId(artifactId) || !isId(product)) throw new ReleaseLifecycleError('invalid-candidate', 'artifact and product ids are required')
  if (!isVersion(version) || !isVersion(serverVersion) || !isVersion(uiVersion)) throw new ReleaseLifecycleError('invalid-candidate', 'artifact, server, and UI versions must be semantic versions')
  if (serverVersion !== version || uiVersion !== version) throw new ReleaseLifecycleError('version-mismatch', 'artifact, server, and UI versions must match exactly')
  if (!Number.isSafeInteger(protocolVersion) || protocolVersion < 1) throw new ReleaseLifecycleError('invalid-candidate', 'protocol version must be a positive integer')
  if (!Array.isArray(files) || files.length === 0 || files.some((file) => !isArtifactFile(file))) throw new ReleaseLifecycleError('invalid-candidate', 'artifact files must contain path, size, and SHA-256 evidence')
  if (!Array.isArray(entrypoints) || entrypoints.some((entrypoint) => !isArtifactEntrypoint(entrypoint))) throw new ReleaseLifecycleError('invalid-candidate', 'artifact entrypoints must contain name, path, size, and SHA-256 evidence')
  const filesByPath = new Map(files.map((file) => [file.path, file]))
  if (
    new Set(entrypoints.map((entrypoint) => entrypoint.name)).size !== entrypoints.length ||
    entrypoints.some((entrypoint) => {
      const file = filesByPath.get(entrypoint.path)
      return file === undefined || file.size !== entrypoint.size || file.sha256 !== entrypoint.sha256
    })
  ) throw new ReleaseLifecycleError('invalid-candidate', 'artifact entrypoints must reference exact manifest files')
  if (signature !== null && !isSignatureEvidence(signature)) throw new ReleaseLifecycleError('invalid-candidate', 'signature evidence is invalid')
  return Object.freeze({
    artifactId,
    product,
    version,
    protocolVersion,
    serverVersion,
    uiVersion,
    files: Object.freeze(files.map((file) => Object.freeze({ ...file }))),
    entrypoints: Object.freeze(entrypoints.map((entrypoint) => Object.freeze({ ...entrypoint }))),
    signature: signature === null ? null : Object.freeze({ ...signature }),
  })
}

export function cleanInstall(candidate, options = {}) {
  const target = options.target ?? UPDATE_TARGETS.STANDALONE_SERVER
  const dataRoot = requireDataRoot(options.dataRoot)
  const serverIdentity = requireIdentity(options.serverIdentity)
  assertUpdateTarget(target)
  assertCandidateForTarget(candidate, target, options)
  return Object.freeze({ target, active: candidate, previous: null, dataRoot, serverIdentity })
}

export function upgrade(state, candidate, options = {}) {
  assertState(state)
  const target = options.target ?? state.target
  assertUpdateTarget(target)
  if (target !== state.target) throw new ReleaseLifecycleError('target-mismatch', 'an update cannot change its host target')
  assertCandidateForTarget(candidate, target, options)
  if (compareVersions(candidate.version, state.active.version) <= 0) throw new ReleaseLifecycleError('not-an-upgrade', 'candidate version must be newer than the active artifact')
  return Object.freeze({ ...state, active: candidate, previous: state.active })
}

export function rollback(state) {
  assertState(state)
  if (state.previous === null) throw new ReleaseLifecycleError('no-rollback', 'no previous artifact is available')
  return Object.freeze({ ...state, active: state.previous, previous: null })
}

export function recoverIncompatible(state, candidate, options = {}) {
  assertState(state)
  try {
    return upgrade(state, candidate, options)
  } catch (error) {
    if (!(error instanceof ReleaseLifecycleError)) throw error
    return Object.freeze({ state, recovery: 'preserved-active', code: error.code })
  }
}

function assertCandidateForTarget(candidate, target, options) {
  if (!candidate || typeof candidate !== 'object') throw new ReleaseLifecycleError('invalid-candidate', 'release candidate is required')
  if (target === UPDATE_TARGETS.REMOTE_SERVER) throw new ReleaseLifecycleError('remote-update-denied', 'a Desktop host must not replace a remote server artifact')
  const expectedProduct = target === UPDATE_TARGETS.DESKTOP_HOST ? 'terminay-desktop' : 'terminay-server'
  if (candidate.product !== expectedProduct) throw new ReleaseLifecycleError('product-mismatch', `candidate product must be ${expectedProduct}`)
  if (options.protocolVersion !== undefined && candidate.protocolVersion !== options.protocolVersion) throw new ReleaseLifecycleError('incompatible-version', 'candidate protocol version is incompatible with the host')
  if (options.serverVersion !== undefined && candidate.serverVersion !== options.serverVersion) throw new ReleaseLifecycleError('incompatible-version', 'candidate server version is incompatible with the host')
  if (options.uiVersion !== undefined && candidate.uiVersion !== options.uiVersion) throw new ReleaseLifecycleError('incompatible-version', 'candidate UI version is incompatible with the host')
}

function assertUpdateTarget(target) {
  if (!Object.values(UPDATE_TARGETS).includes(target)) throw new ReleaseLifecycleError('invalid-target', 'update target is not supported')
}

function assertState(state) {
  if (!state || typeof state !== 'object' || state.active === null || state.active === undefined || state.dataRoot === undefined || state.serverIdentity === undefined) throw new ReleaseLifecycleError('invalid-state', 'release state is incomplete')
  assertUpdateTarget(state.target)
}

function requireDataRoot(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4_096 || !value.startsWith('/')) throw new ReleaseLifecycleError('invalid-state', 'data root must be an absolute path')
  return value
}

function requireIdentity(value) {
  if (!isId(value)) throw new ReleaseLifecycleError('invalid-state', 'server identity is required')
  return value
}

function isId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
}

function isVersion(value) {
  return typeof value === 'string' && SEMVER.test(value)
}

function isArtifactFile(value) {
  return value && typeof value === 'object' && typeof value.path === 'string' && value.path.length > 0 && !value.path.startsWith('/') && !value.path.includes('..') && Number.isSafeInteger(value.size) && value.size >= 0 && /^[a-f0-9]{64}$/u.test(value.sha256)
}

function isArtifactEntrypoint(value) {
  return value && typeof value === 'object' && typeof value.name === 'string' && /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u.test(value.name) && isArtifactFile(value)
}

function isSignatureEvidence(value) {
  return value && typeof value === 'object' && typeof value.algorithm === 'string' && typeof value.keyId === 'string' && typeof value.signatureFile === 'string'
}

function compareVersions(left, right) {
  const a = left.match(SEMVER)
  const b = right.match(SEMVER)
  if (!a || !b) throw new ReleaseLifecycleError('invalid-candidate', 'versions must be semantic versions')
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(a[index]) - Number(b[index])
    if (difference !== 0) return difference
  }
  return 0
}
