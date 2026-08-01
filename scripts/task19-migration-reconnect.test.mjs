import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { transform } from 'esbuild'
import {
  LEGACY_MANAGER_ORIGIN,
  MigrationRunner,
  sanitizeManagerProfiles,
} from '@terminay/server-core'

const SESSION_ORIGIN = 'https://session-prod.terminay.com'
const SESSION_ID = 'session-prod'
const DEVICE_ID = 'device-prod'
const TRANSPORT_ORIGIN = `${SESSION_ORIGIN}#transport=webrtc:${SESSION_ORIGIN}`

test('migration preserves the session origin and reconnects an existing grant', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-task19-migration-reconnect-'))
  const grantPath = join(tempDir, 'reconnect-grants.json')
  const { ReconnectGrantStore, createReconnectProof } = await importReconnectGrantStore()
  const clock = { value: Date.parse('2026-07-27T12:00:00.000Z') }
  const now = () => new Date(clock.value)

  const beforeMigration = new ReconnectGrantStore(grantPath, now)
  await beforeMigration.load()
  const issued = await beforeMigration.issueGrant({
    deviceId: DEVICE_ID,
    lifetime: 'until-revoked',
    origin: TRANSPORT_ORIGIN,
    sessionId: SESSION_ID,
  })

  let marker
  let importedProfiles
  const backend = {
    async loadMarker() { return marker },
    async saveMarker(value) { marker = structuredClone(value) },
    async backup(source) { return `backup-${source.migrationId}` },
    async importSettings() {},
    async importMacros() {},
    async importConnectionProfiles(value) {
      importedProfiles = sanitizeManagerProfiles(value, { sourceOrigin: LEGACY_MANAGER_ORIGIN })
    },
    async importProjects() {},
    async importRecordings() {},
    async importSecret() {},
  }

  const runner = new MigrationRunner(backend, {
    migrationId: 'task19-origin-reconnect',
    now: () => clock.value,
  })
  const legacySource = {
    connectionProfiles: {
      profiles: [{
        id: 'remote-prod',
        serverId: 'server-prod',
        origin: SESSION_ORIGIN,
        label: 'Production',
        kind: 'remote',
        fingerprint: 'sha256:prod',
        reconnectHandle: issued.handle,
        reconnectGrant: issued.grant,
      }],
    },
  }

  const result = await runner.run(legacySource)
  assert.equal(result.marker.status, 'complete')
  assert.equal(importedProfiles.profiles[0].origin, SESSION_ORIGIN)
  assert.equal(importedProfiles.profiles[0].serverId, 'server-prod')
  assert.equal(JSON.stringify(importedProfiles).includes(issued.grant), false)
  assert.equal(JSON.stringify(importedProfiles).includes(issued.handle), false)

  const afterMigration = new ReconnectGrantStore(grantPath, now)
  await afterMigration.load()
  const persisted = afterMigration.listActive().find((grant) => grant.deviceId === DEVICE_ID)
  assert.ok(persisted)
  assert.equal(persisted.origin, TRANSPORT_ORIGIN)
  assert.equal(new URL(persisted.origin).origin, importedProfiles.profiles[0].origin)
  assert.equal(persisted.sessionId, SESSION_ID)

  const challenge = await afterMigration.createChallenge({
    clientNonce: 'migration-reconnect-client',
    handle: issued.handle,
    origin: TRANSPORT_ORIGIN,
    sessionId: SESSION_ID,
  })
  const verified = await afterMigration.verifyProof({
    attemptId: challenge.payload.attemptId,
    clientNonce: 'migration-reconnect-client',
    handle: issued.handle,
    origin: TRANSPORT_ORIGIN,
    proof: createReconnectProof(issued.grant, challenge.signingInput),
  })
  assert.equal(verified.deviceId, DEVICE_ID)
  assert.equal(verified.origin, TRANSPORT_ORIGIN)
  assert.equal(verified.sessionId, SESSION_ID)

  const persistedFile = await readFile(grantPath, 'utf8')
  assert.equal(persistedFile.includes(issued.grant), false)
  assert.equal(persistedFile.includes(issued.handle), true)
})

async function importReconnectGrantStore() {
  const source = await readFile(new URL('../electron/remote/reconnectGrantStore.ts', import.meta.url), 'utf8')
  const transformed = await transform(source, {
    format: 'esm',
    loader: 'ts',
    platform: 'node',
    target: 'node20',
  })
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-task19-reconnect-import-'))
  const outputPath = join(tempDir, 'reconnectGrantStore.mjs')
  await writeFile(outputPath, transformed.code)
  return import(outputPath)
}
