import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cleanInstall,
  createCandidate,
  recoverIncompatible,
  ReleaseLifecycleError,
  rollback,
  sha256,
  UPDATE_TARGETS,
  upgrade,
} from './task20-release-lifecycle.mjs'

function candidate(version, product = 'terminay-server', protocolVersion = 1) {
  return createCandidate({
    artifactId: `${product}-${version}`,
    files: [{ path: 'dist/cli.js', size: 3, sha256: sha256('cli') }],
    product,
    protocolVersion,
    serverVersion: version,
    uiVersion: version,
    version,
  })
}

test('clean install creates one active artifact and preserves the server identity boundary', () => {
  const state = cleanInstall(candidate('1.0.0'), { dataRoot: '/var/lib/terminay', serverIdentity: 'server-a' })
  assert.equal(state.active.artifactId, 'terminay-server-1.0.0')
  assert.equal(state.previous, null)
  assert.equal(state.dataRoot, '/var/lib/terminay')
  assert.equal(state.serverIdentity, 'server-a')
})

test('upgrade stages a newer artifact and rollback restores the exact previous artifact', () => {
  const initial = cleanInstall(candidate('1.0.0'), { dataRoot: '/var/lib/terminay', serverIdentity: 'server-a' })
  const upgraded = upgrade(initial, candidate('1.1.0'))
  assert.equal(upgraded.active.version, '1.1.0')
  assert.equal(upgraded.previous.artifactId, 'terminay-server-1.0.0')
  assert.equal(upgraded.dataRoot, initial.dataRoot)
  assert.equal(upgraded.serverIdentity, initial.serverIdentity)
  assert.equal(rollback(upgraded).active.artifactId, initial.active.artifactId)
})

test('incompatible or malformed upgrades preserve the active artifact for recovery', () => {
  const initial = cleanInstall(candidate('1.0.0'), { dataRoot: '/var/lib/terminay', serverIdentity: 'server-a', protocolVersion: 1 })
  const result = recoverIncompatible(initial, candidate('2.0.0', 'terminay-server', 2), { protocolVersion: 1 })
  assert.equal(result.recovery, 'preserved-active')
  assert.equal(result.state.active.artifactId, initial.active.artifactId)
  assert.equal(result.code, 'incompatible-version')
  assert.throws(() => upgrade(initial, candidate('0.9.0')), (error) => error instanceof ReleaseLifecycleError && error.code === 'not-an-upgrade')
})

test('a candidate cannot claim an artifact version different from its server or UI payload', () => {
  const base = {
    artifactId: 'terminay-desktop-1.0.0',
    files: [{ path: 'dist/cli.js', size: 3, sha256: sha256('cli') }],
    product: 'terminay-desktop',
    protocolVersion: 1,
    version: '1.0.0',
  }
  assert.throws(
    () => createCandidate({ ...base, serverVersion: '1.1.0', uiVersion: '1.0.0' }),
    (error) => error instanceof ReleaseLifecycleError && error.code === 'version-mismatch',
  )
  assert.throws(
    () => createCandidate({ ...base, serverVersion: '1.0.0', uiVersion: '1.1.0' }),
    (error) => error instanceof ReleaseLifecycleError && error.code === 'version-mismatch',
  )
})

test('Desktop and standalone updates are independent and remote servers cannot be replaced implicitly', () => {
  const desktop = cleanInstall(candidate('1.0.0', 'terminay-desktop'), { dataRoot: '/var/lib/terminay', serverIdentity: 'server-a', target: UPDATE_TARGETS.DESKTOP_HOST })
  assert.equal(upgrade(desktop, candidate('1.1.0', 'terminay-desktop')).target, UPDATE_TARGETS.DESKTOP_HOST)
  assert.throws(() => cleanInstall(candidate('1.0.0'), { dataRoot: '/var/lib/terminay', serverIdentity: 'server-a', target: UPDATE_TARGETS.REMOTE_SERVER }), (error) => error instanceof ReleaseLifecycleError && error.code === 'remote-update-denied')
})
