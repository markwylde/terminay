import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const TASK19 = 'specs/tasks_completed/19-migration-and-compatibility-cleanup.md'
const TASK20 = 'specs/tasks_completed/20-security-release-and-operations.md'

const EVIDENCE_FILES = Object.freeze([
  'packages/server-core/test/migration-compatibility.test.mjs',
  'packages/server-core/test/migration-electron-rollback.test.mjs',
  'packages/server-core/test/migration-recovery.test.mjs',
  'packages/server-core/test/remote-reconnect.test.mjs',
  'scripts/task19-migration-reconnect.test.mjs',
  'scripts/task19-compatibility-matrix.test.mjs',
  'scripts/task19-application-protocol.test.mjs',
  'scripts/task19-preload-compatibility-boundary.test.mjs',
  'scripts/hosted-deployment-order.test.mjs',
  'scripts/task20-release-lifecycle.test.mjs',
  'scripts/task20-release-artifact.test.mjs',
  'scripts/task20-supply-chain-audit.test.mjs',
  'scripts/task20-direct-ui-mismatch.test.mjs',
  'specs/operations/release-update-policy.md',
  'specs/decisions/evidence/task20-supply-chain-audit.md',
])

/**
 * Read the migration/release checklists without treating nearby prose as a
 * completed item. This is intentionally a docs-only audit: it does not
 * inspect or mutate application/runtime state.
 */
export async function auditTask19And20(root = process.cwd()) {
  const [task19Text, task20Text] = await Promise.all([
    readTask(root, TASK19),
    readTask(root, TASK20),
  ])
  const evidence = []
  for (const path of EVIDENCE_FILES) {
    await readFile(join(root, path), 'utf8')
    evidence.push(path)
  }

  return Object.freeze({
    schemaVersion: 1,
    generatedBy: 'scripts/task19-20-audit.mjs',
    task19: summarizeChecklist(task19Text),
    task20: Object.freeze({
      ...summarizeChecklist(task20Text),
      operationalFollowUps: summarizeOperationalFollowUps(task20Text),
    }),
    evidence: Object.freeze(evidence),
    boundaries: Object.freeze({
      sessionOriginAndReconnectGrant: 'exact session origin preserved; persisted reconnect-grant continuity proven by scripts/task19-migration-reconnect.test.mjs',
      compatibilityAdapters: 'fail-closed runtime flags, migrated client paths, and stable scoped host boundaries are tested; final compatibility cleanup remains gated on real shared-UI parity',
      hostedDeployment: 'local hosted compatibility-window and dependency-order model is tested; external hosted deployment execution remains unproven',
      migrationRollback: 'pre-commit Electron restoration and post-commit explicit backup recovery are proven by packages/server-core/test/migration-electron-rollback.test.mjs',
      releaseLifecycle: 'unsigned file-backed artifact transitions are tested; signed packaged install/upgrade execution unproven',
      nativeAndWebRtcArtifacts: 'metadata and candidate evidence exist; supported release publication/certification unproven',
    }),
  })
}

async function readTask(root, taskPath) {
  try {
    return await readFile(join(root, taskPath), 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return readFile(join(root, 'specs/tasks_completed', basename(taskPath)), 'utf8')
  }
}

function summarizeOperationalFollowUps(text) {
  return Object.freeze(
    text
      .split(/\r?\n/u)
      .map((line) => /^\s*-\s+Operational\/release follow-up:\s+(.+)$/u.exec(line)?.[1])
      .filter((item) => item !== undefined),
  )
}

function summarizeChecklist(text) {
  const items = []
  for (const line of text.split(/\r?\n/u)) {
    const match = /^\s*- \[([ xX])\] (.+)$/u.exec(line)
    if (match === null) continue
    items.push(Object.freeze({ checked: match[1].toLowerCase() === 'x', text: match[2] }))
  }
  return Object.freeze({
    checkedCount: items.filter((item) => item.checked).length,
    openCount: items.filter((item) => !item.checked).length,
    checkedItems: Object.freeze(items.filter((item) => item.checked).map((item) => item.text)),
    openItems: Object.freeze(items.filter((item) => !item.checked).map((item) => item.text)),
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await auditTask19And20(process.cwd()), null, 2))
}
