import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyCompatibleUpgrade,
  createInstallation,
  createUpgradeCandidate,
  UpgradeCompatibilityError,
} from './task20-upgrade-compatibility.mjs'

function active() {
  return createInstallation({
    artifactVersion: '1.4.0',
    dataSchema: 4,
    serverId: 'server_12345678',
    uiProtocol: 7,
  })
}

test('a forward-compatible update preserves server identity and returns a deterministic receipt', () => {
  const installation = active()
  const candidate = createUpgradeCandidate({
    artifactVersion: '1.5.0',
    dataSchema: 5,
    migration: 'forward-compatible',
    uiProtocol: 7,
  })
  const first = applyCompatibleUpgrade(installation, candidate)
  const second = applyCompatibleUpgrade(installation, candidate)

  assert.equal(first.action, 'activated')
  assert.equal(first.installation.serverId, installation.serverId)
  assert.equal(first.installation.dataSchema, 5)
  assert.equal(first.receipt, second.receipt)
  assert.match(first.receipt, /^[a-f0-9]{64}$/u)
})

for (const [name, candidate, reason] of [
  ['protocol mismatch', { artifactVersion: '1.5.0', dataSchema: 4, migration: 'none', uiProtocol: 8 }, 'ui-protocol-incompatible'],
  ['schema downgrade', { artifactVersion: '1.5.0', dataSchema: 3, migration: 'none', uiProtocol: 7 }, 'data-schema-downgrade'],
  ['unsafe migration', { artifactVersion: '1.5.0', dataSchema: 5, migration: 'none', uiProtocol: 7 }, 'migration-not-recoverable'],
  ['non-newer artifact', { artifactVersion: '1.4.0', dataSchema: 4, migration: 'none', uiProtocol: 7 }, 'not-a-newer-artifact'],
]) {
  test(`${name} recovers the exact prior installation without mutating its identity`, () => {
    const installation = active()
    const outcome = applyCompatibleUpgrade(installation, createUpgradeCandidate(candidate))
    assert.deepEqual(outcome, { action: 'recovered-active', installation, reason })
    assert.equal(outcome.installation, installation)
  })
}

test('malformed compatibility records fail before an upgrade decision exists', () => {
  assert.throws(
    () => createInstallation({ artifactVersion: '1.4', dataSchema: 4, serverId: 'server_12345678', uiProtocol: 7 }),
    (error) => error instanceof UpgradeCompatibilityError && error.code === 'artifact-version-invalid',
  )
  assert.throws(
    () => createUpgradeCandidate({ artifactVersion: '1.5.0', dataSchema: 5, migration: 'destructive', uiProtocol: 7 }),
    (error) => error instanceof UpgradeCompatibilityError && error.code === 'migration-invalid',
  )
})
