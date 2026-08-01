import assert from 'node:assert/strict'
import test from 'node:test'
import { auditTask19And20 } from './task19-20-audit.mjs'

test('migration and release audit keeps execution gates distinct from local evidence', async () => {
  const report = await auditTask19And20()

  assert.equal(report.schemaVersion, 1)
  // Narrow, independently-tested compatibility reductions may be added while
  // the two locally actionable gates remain open. Do not turn this audit into a
  // stale progress counter that rejects those reductions.
  assert.ok(report.task19.checkedCount >= 43)
  assert.equal(report.task19.openCount, 2)
  // Keep the audit tied to the authoritative checklist. Narrow local evidence
  // may grow, but the remaining cleanup gate remains open.
  assert.ok(report.task20.checkedCount >= 79)
  assert.equal(report.task20.openCount, 0)
  assert.equal(report.task20.operationalFollowUps.length, 6)
  const releaseFollowUps = report.task20.operationalFollowUps.join('\n')
  assert.match(releaseFollowUps, /measure the selected WebRTC runtime/u)
  assert.match(releaseFollowUps, /run the selected-artifact sustained load harness/u)
  assert.match(releaseFollowUps, /publish signed\/notarized Desktop artifacts/u)
  assert.match(releaseFollowUps, /publish verified standalone artifacts/u)
  assert.match(releaseFollowUps, /run the complete PTY and server probes/u)
  assert.match(releaseFollowUps, /produce deterministic WebRTC runtime artifacts/u)

  assert.match(report.task19.openItems.join('\n'), /Complete the project-code and reproducible rendered feature matrix/u)
  assert.match(report.task19.openItems.join('\n'), /Remove broad application preload IPC/u)

  assert.match(
    report.task20.checkedItems.join('\n'),
    /Prove the locked Secure-Werift candidate interoperates/u,
  )

  assert.equal(report.boundaries.sessionOriginAndReconnectGrant, 'exact session origin preserved; persisted reconnect-grant continuity proven by scripts/task19-migration-reconnect.test.mjs')
  assert.equal(report.boundaries.compatibilityAdapters, 'fail-closed runtime flags, migrated client paths, and stable scoped host boundaries are tested; final compatibility cleanup remains gated on real shared-UI parity')
  assert.equal(report.boundaries.hostedDeployment, 'local hosted compatibility-window and dependency-order model is tested; external hosted deployment execution remains unproven')
  assert.equal(report.boundaries.migrationRollback, 'pre-commit Electron restoration and post-commit explicit backup recovery are proven by packages/server-core/test/migration-electron-rollback.test.mjs')
  assert.ok(report.evidence.includes('packages/server-core/test/migration-electron-rollback.test.mjs'))
  assert.equal(report.boundaries.releaseLifecycle, 'unsigned file-backed artifact transitions are tested; signed packaged install/upgrade execution unproven')
  assert.ok(report.evidence.includes('packages/server-core/test/remote-reconnect.test.mjs'))
  assert.ok(report.evidence.includes('scripts/task19-compatibility-matrix.test.mjs'))
  assert.ok(report.evidence.includes('scripts/task19-application-protocol.test.mjs'))
  assert.ok(report.evidence.includes('scripts/task19-preload-compatibility-boundary.test.mjs'))
  assert.ok(report.evidence.includes('scripts/hosted-deployment-order.test.mjs'))
  assert.ok(report.evidence.includes('scripts/task20-release-lifecycle.test.mjs'))
  assert.ok(report.evidence.includes('scripts/task20-release-artifact.test.mjs'))
})
