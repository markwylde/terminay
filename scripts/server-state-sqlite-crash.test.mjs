import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { backup, DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const initialMigration = Object.freeze({
  checksum: 'sha256:terminay-state-v1',
  name: 'initial-state',
  version: 1,
})
const auditMigration = Object.freeze({
  checksum: 'sha256:terminay-state-v2',
  name: 'audit-records',
  version: 2,
})

function configureConnection(database, busyTimeoutMs = 5_000) {
  if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
    throw new TypeError('busyTimeoutMs must be a non-negative safe integer.')
  }
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = ${busyTimeoutMs};
  `)
}

function openConnection(databasePath, busyTimeoutMs = 5_000) {
  const database = new DatabaseSync(databasePath)
  try {
    configureConnection(database, busyTimeoutMs)
    return database
  } catch (error) {
    database.close()
    throw error
  }
}

function openReadOnlyConnection(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true })
  try {
    configureConnection(database)
    return database
  } catch (error) {
    database.close()
    throw error
  }
}

function initializeDatabase(databasePath) {
  const database = openConnection(databasePath)
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS workspace_state (
      id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS revisions (
      revision INTEGER PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)
  database
    .prepare(`
      INSERT OR IGNORE INTO schema_migrations (version, name, checksum, applied_at)
      VALUES (?, ?, ?, ?)
    `)
    .run(
      initialMigration.version,
      initialMigration.name,
      initialMigration.checksum,
      '2026-07-27T00:00:00.000Z',
    )
  return database
}

function commitRevision(database, expectedRevision, nextRevision, value) {
  database.exec('BEGIN IMMEDIATE')
  try {
    const current = database
      .prepare('SELECT revision FROM workspace_state WHERE id = ?')
      .get('workspace')
    const actualRevision = current?.revision ?? 0
    if (actualRevision !== expectedRevision) {
      database.exec('ROLLBACK')
      return {
        actualRevision,
        expectedRevision,
        kind: 'revision-conflict',
      }
    }

    if (actualRevision === 0) {
      database
        .prepare('INSERT INTO workspace_state (id, revision, value) VALUES (?, ?, ?)')
        .run('workspace', nextRevision, value)
    } else {
      database
        .prepare('UPDATE workspace_state SET revision = ?, value = ? WHERE id = ?')
        .run(nextRevision, value, 'workspace')
    }
    database
      .prepare('INSERT INTO revisions (revision, value) VALUES (?, ?)')
      .run(nextRevision, value)
    database.exec('COMMIT')
    return { kind: 'committed', revision: nextRevision }
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {
      // Preserve the original SQLite failure.
    }
    throw error
  }
}

function seedRevision(databasePath) {
  const database = initializeDatabase(databasePath)
  assert.deepEqual(commitRevision(database, 0, 1, 'revision-1'), {
    kind: 'committed',
    revision: 1,
  })
  database.close()
}

function applyAuditMigration(database, checkpoint, commit = true) {
  const applied = database
    .prepare('SELECT name, checksum FROM schema_migrations WHERE version = ?')
    .get(auditMigration.version)
  if (applied) {
    assert.deepEqual(
      { ...applied },
      { checksum: auditMigration.checksum, name: auditMigration.name },
      'an existing numbered migration must retain its expected name and checksum',
    )
    return 'already-applied'
  }

  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(`
      CREATE TABLE audit_records (
        id TEXT PRIMARY KEY,
        workspace_revision INTEGER NOT NULL,
        action TEXT NOT NULL,
        FOREIGN KEY (workspace_revision) REFERENCES revisions(revision)
      );
    `)
    database
      .prepare(`
        INSERT INTO schema_migrations (version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(
        auditMigration.version,
        auditMigration.name,
        auditMigration.checksum,
        '2026-07-27T00:00:01.000Z',
      )
    checkpoint?.()
    if (!commit) return 'transaction-open'
    database.exec('COMMIT')
    return 'applied'
  } catch (error) {
    try {
      database.exec('ROLLBACK')
    } catch {
      // Preserve the original migration failure.
    }
    throw error
  }
}

function readState(databasePath) {
  const database = openConnection(databasePath)
  try {
    const workspaceRow = database
      .prepare('SELECT revision, value FROM workspace_state WHERE id = ?')
      .get('workspace')
    const workspace = workspaceRow ? { ...workspaceRow } : undefined
    const revisions = database
      .prepare('SELECT revision, value FROM revisions ORDER BY revision')
      .all()
      .map((row) => ({ ...row }))
    const migrations = database
      .prepare(`
        SELECT version, name, checksum
        FROM schema_migrations
        ORDER BY version
      `)
      .all()
      .map((row) => ({ ...row }))
    const integrity = database.prepare('PRAGMA integrity_check').get()
    const journalMode = database.prepare('PRAGMA journal_mode').get()
    const auditTable = database
      .prepare(`
        SELECT COUNT(*) AS count
        FROM sqlite_schema
        WHERE type = 'table' AND name = 'audit_records'
      `)
      .get()
    return {
      auditTableExists: auditTable.count === 1,
      integrity,
      journalMode,
      migrations,
      revisions,
      workspace,
    }
  } finally {
    database.close()
  }
}

function spawnCheckpointChild(databasePath, mode) {
  const child = spawn(process.execPath, [scriptPath, '--child', databasePath, mode], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  let stdout = ''
  let settled = false
  const checkpoint = new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      callback(value)
    }
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
      if (stdout.includes(`${mode}\n`)) finish(resolve)
    })
    child.on('error', (error) => finish(reject, error))
    child.on('exit', (code, signal) => {
      if (!stdout.includes(`${mode}\n`)) {
        finish(
          reject,
          new Error(
            `Child exited before ${mode} (code=${code}, signal=${signal}).`,
          ),
        )
      }
    })
  })
  return { checkpoint, child }
}

async function killAtCheckpoint(databasePath, mode) {
  const running = spawnCheckpointChild(databasePath, mode)
  await running.checkpoint
  await killChild(running.child)
}

function killChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  child.kill('SIGKILL')
  return exited
}

function isSqliteBusy(error) {
  return (
    error?.code === 'ERR_SQLITE_ERROR' &&
    error?.errcode === 5 &&
    error?.errstr === 'database is locked'
  )
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function makeOnlineBackup(databasePath, backupPath) {
  await mkdir(dirname(backupPath), { recursive: true })
  const source = openConnection(databasePath)
  try {
    const pages = await backup(source, backupPath)
    assert.ok(pages > 0, 'the online backup must copy at least one page')
  } finally {
    source.close()
  }
}

async function recoverBesideCorruptEvidence(backupPath, recoveryPath) {
  await mkdir(dirname(recoveryPath), { recursive: true })
  await copyFile(backupPath, recoveryPath)
  const recovered = readState(recoveryPath)
  assert.equal(recovered.integrity.integrity_check, 'ok')
  return recovered
}

if (process.argv[2] === '--child') {
  const databasePath = process.argv[3]
  const mode = process.argv[4]
  const database = openConnection(databasePath)
  if (mode === 'transaction-open' || mode === 'commit-complete') {
    database.exec('BEGIN IMMEDIATE')
    database
      .prepare('UPDATE workspace_state SET revision = ?, value = ? WHERE id = ?')
      .run(2, 'revision-2', 'workspace')
    database
      .prepare('INSERT INTO revisions (revision, value) VALUES (?, ?)')
      .run(2, 'revision-2')
    if (mode === 'commit-complete') database.exec('COMMIT')
    process.stdout.write(`${mode}\n`)
  } else if (mode === 'migration-open') {
    applyAuditMigration(
      database,
      () => process.stdout.write('migration-open\n'),
      false,
    )
  } else if (mode === 'writer-hold') {
    database.exec('BEGIN IMMEDIATE')
    database
      .prepare('UPDATE workspace_state SET revision = ?, value = ? WHERE id = ?')
      .run(2, 'uncommitted-revision-2', 'workspace')
    database
      .prepare('INSERT INTO revisions (revision, value) VALUES (?, ?)')
      .run(2, 'uncommitted-revision-2')
    process.stdout.write('writer-hold\n')
  } else {
    throw new Error(`Unknown child mode: ${mode}`)
  }
  setInterval(() => {}, 1_000)
} else {
  test('SQLite discards an interrupted uncommitted workspace revision', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'terminay-sqlite-crash-'))
    const databasePath = join(directory, 'server-state.sqlite')
    try {
      seedRevision(databasePath)
      await killAtCheckpoint(databasePath, 'transaction-open')
      const state = readState(databasePath)
      assert.deepEqual(state.workspace, {
        revision: 1,
        value: 'revision-1',
      })
      assert.deepEqual(state.revisions, [
        { revision: 1, value: 'revision-1' },
      ])
      assert.equal(state.integrity.integrity_check, 'ok')
      assert.equal(state.journalMode.journal_mode, 'wal')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  test('SQLite preserves a fully committed workspace revision after process death', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'terminay-sqlite-commit-'))
    const databasePath = join(directory, 'server-state.sqlite')
    try {
      seedRevision(databasePath)
      await killAtCheckpoint(databasePath, 'commit-complete')
      const state = readState(databasePath)
      assert.deepEqual(state.workspace, {
        revision: 2,
        value: 'revision-2',
      })
      assert.deepEqual(state.revisions, [
        { revision: 1, value: 'revision-1' },
        { revision: 2, value: 'revision-2' },
      ])
      assert.equal(state.integrity.integrity_check, 'ok')
      assert.equal(state.journalMode.journal_mode, 'wal')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  test('an interrupted numbered migration rolls back its schema and ledger, then applies exactly once', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'terminay-sqlite-migration-'))
    const databasePath = join(directory, 'server-state.sqlite')
    try {
      seedRevision(databasePath)
      await killAtCheckpoint(databasePath, 'migration-open')

      const interrupted = readState(databasePath)
      assert.equal(interrupted.auditTableExists, false)
      assert.deepEqual(interrupted.migrations, [
        {
          checksum: initialMigration.checksum,
          name: initialMigration.name,
          version: initialMigration.version,
        },
      ])
      assert.equal(interrupted.integrity.integrity_check, 'ok')

      const database = openConnection(databasePath)
      assert.equal(applyAuditMigration(database), 'applied')
      assert.equal(applyAuditMigration(database), 'already-applied')
      database.close()

      const recovered = readState(databasePath)
      assert.equal(recovered.auditTableExists, true)
      assert.deepEqual(recovered.migrations, [
        {
          checksum: initialMigration.checksum,
          name: initialMigration.name,
          version: initialMigration.version,
        },
        {
          checksum: auditMigration.checksum,
          name: auditMigration.name,
          version: auditMigration.version,
        },
      ])
      assert.equal(recovered.integrity.integrity_check, 'ok')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  test('an online backup restores the last recovery point beside unchanged corrupt evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'terminay-sqlite-backup-'))
    const databasePath = join(directory, 'server-state.sqlite')
    const backupPath = join(directory, 'backups', 'revision-2.sqlite')
    const recoveryPath = join(directory, 'recovered', 'server-state.sqlite')
    try {
      seedRevision(databasePath)
      let database = openConnection(databasePath)
      assert.deepEqual(commitRevision(database, 1, 2, 'revision-2'), {
        kind: 'committed',
        revision: 2,
      })
      database.close()
      await makeOnlineBackup(databasePath, backupPath)

      database = openConnection(databasePath)
      assert.deepEqual(commitRevision(database, 2, 3, 'revision-3'), {
        kind: 'committed',
        revision: 3,
      })
      database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      database.close()

      const canonicalBytes = await readFile(databasePath)
      canonicalBytes.fill(0, 0, Math.min(32, canonicalBytes.length))
      await writeFile(databasePath, canonicalBytes)
      const corruptHash = await sha256(databasePath)

      assert.throws(
        () => readState(databasePath),
        /database|file|disk|encrypted|malformed/i,
        'opening or checking the damaged canonical database must detect corruption',
      )
      const recovered = await recoverBesideCorruptEvidence(
        backupPath,
        recoveryPath,
      )
      assert.deepEqual(recovered.workspace, {
        revision: 2,
        value: 'revision-2',
      })
      assert.deepEqual(recovered.revisions, [
        { revision: 1, value: 'revision-1' },
        { revision: 2, value: 'revision-2' },
      ])
      assert.equal(
        await sha256(databasePath),
        corruptHash,
        'recovery must preserve the corrupt canonical database for diagnosis',
      )
      assert.notEqual(
        recoveryPath,
        databasePath,
        'the validated recovery database must not replace corrupt evidence',
      )
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  test('WAL readers remain available while writers serialize with bounded busy errors and revision conflicts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'terminay-sqlite-clients-'))
    const databasePath = join(directory, 'server-state.sqlite')
    let holdingWriter
    try {
      seedRevision(databasePath)
      holdingWriter = spawnCheckpointChild(databasePath, 'writer-hold')
      await holdingWriter.checkpoint

      const readerStartedAt = Date.now()
      const reader = openConnection(databasePath, 0)
      const visible = reader
        .prepare('SELECT revision, value FROM workspace_state WHERE id = ?')
        .get('workspace')
      reader.close()
      assert.deepEqual({ ...visible }, {
        revision: 1,
        value: 'revision-1',
      })
      assert.ok(
        Date.now() - readerStartedAt < 1_000,
        'a WAL reader must not wait for the uncommitted writer',
      )

      const competingWriter = openConnection(databasePath, 75)
      const busyStartedAt = Date.now()
      assert.throws(
        () => competingWriter.exec('BEGIN IMMEDIATE'),
        isSqliteBusy,
        'a second writer must receive a bounded SQLITE_BUSY result',
      )
      assert.ok(
        Date.now() - busyStartedAt < 2_000,
        'writer contention must respect the bounded busy timeout',
      )
      competingWriter.close()

      await killChild(holdingWriter.child)

      const serializedWriter = openConnection(databasePath)
      assert.deepEqual(
        commitRevision(serializedWriter, 1, 2, 'committed-revision-2'),
        { kind: 'committed', revision: 2 },
      )
      assert.deepEqual(
        commitRevision(serializedWriter, 1, 3, 'stale-client-revision-3'),
        {
          actualRevision: 2,
          expectedRevision: 1,
          kind: 'revision-conflict',
        },
      )
      serializedWriter.close()

      const state = readState(databasePath)
      assert.deepEqual(state.workspace, {
        revision: 2,
        value: 'committed-revision-2',
      })
      assert.deepEqual(state.revisions, [
        { revision: 1, value: 'revision-1' },
        { revision: 2, value: 'committed-revision-2' },
      ])
      assert.equal(state.integrity.integrity_check, 'ok')
    } finally {
      if (holdingWriter) await killChild(holdingWriter.child)
      await rm(directory, { force: true, recursive: true })
    }
  })

  test('a read-only recovered state remains queryable and rejects a complete revision without partial writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'terminay-sqlite-read-only-'))
    const databasePath = join(directory, 'server-state.sqlite')
    try {
      seedRevision(databasePath)
      const before = readState(databasePath)
      const database = openReadOnlyConnection(databasePath)
      try {
        const visible = database
          .prepare('SELECT revision, value FROM workspace_state WHERE id = ?')
          .get('workspace')
        assert.deepEqual({ ...visible }, { revision: 1, value: 'revision-1' })
        assert.throws(
          () => commitRevision(database, 1, 2, 'must-not-persist'),
          /readonly|read-only/i,
          'a read-only state must fail before a revision can be committed',
        )
      } finally {
        database.close()
      }
      assert.deepEqual(
        readState(databasePath),
        before,
        'a rejected read-only write must leave the canonical state byte-for-byte equivalent at the logical boundary',
      )
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  test('filesystem permissions reject SQLite mutation without changing canonical state', async (context) => {
    if (process.platform === 'win32') {
      context.skip('POSIX permission enforcement is covered on supported macOS/Linux hosts')
      return
    }
    const directory = await mkdtemp(join(tmpdir(), 'terminay-sqlite-permissions-'))
    const databasePath = join(directory, 'server-state.sqlite')
    try {
      seedRevision(databasePath)
      const before = readState(databasePath)
      await chmod(databasePath, 0o444)
      await chmod(directory, 0o555)
      assert.throws(
        () => {
          const database = openConnection(databasePath)
          try {
            commitRevision(database, 1, 2, 'must-not-persist')
          } finally {
            database.close()
          }
        },
        /readonly|read-only|permission|access/i,
      )
      await chmod(directory, 0o755)
      await chmod(databasePath, 0o644)
      assert.deepEqual(readState(databasePath), before)
    } finally {
      await chmod(directory, 0o755).catch(() => undefined)
      await chmod(databasePath, 0o644).catch(() => undefined)
      await rm(directory, { force: true, recursive: true })
    }
  })

  test('a deterministic full-disk SQLite boundary rolls back the complete revision and recovers after capacity returns', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'terminay-sqlite-full-disk-'))
    const databasePath = join(directory, 'server-state.sqlite')
    try {
      seedRevision(databasePath)
      const before = readState(databasePath)
      const constrained = openConnection(databasePath)
      try {
        const pageCount = constrained.prepare('PRAGMA page_count').get().page_count
        constrained.exec(`PRAGMA max_page_count = ${pageCount}`)
        assert.throws(
          () => commitRevision(constrained, 1, 2, 'x'.repeat(1_048_576)),
          /full|space|disk/i,
          'a capacity-constrained state must fail before a complete revision can commit',
        )
        constrained.exec('PRAGMA max_page_count = 1073741823')
        assert.deepEqual(
          commitRevision(constrained, 1, 2, 'recovered-after-capacity'),
          { kind: 'committed', revision: 2 },
          'removing the deterministic capacity limit must permit a fresh complete revision',
        )
      } finally {
        constrained.close()
      }
      const after = readState(databasePath)
      assert.deepEqual(after.workspace, {
        revision: 2,
        value: 'recovered-after-capacity',
      })
      assert.deepEqual(after.revisions, [
        { revision: 1, value: 'revision-1' },
        { revision: 2, value: 'recovered-after-capacity' },
      ])
      assert.equal(after.integrity.integrity_check, 'ok')
      assert.notDeepEqual(after, before, 'only the later recovered revision may mutate canonical state')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
}
