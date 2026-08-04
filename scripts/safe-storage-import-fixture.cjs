const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto')
const { mkdirSync, readFileSync, writeFileSync, appendFileSync } = require('node:fs')
const { join } = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { app, safeStorage } = require('electron')

const casePath = process.argv[2]
const action = process.argv[3]
const failureBoundary = process.argv[4] || null
const sentinel = 'terminay-safe-storage-import-sentinel'
const source = 'electron-safe-storage'

const failureBoundaries = [
  'source-read',
  'legacy-decrypted',
  'vault-encrypted',
  'key-wrapped',
  'transaction-begun',
  'entry-written',
  'key-written',
  'ledger-written',
  'transaction-committed',
]

if (!casePath || !['seed', 'import'].includes(action)) {
  throw new Error('Usage: safe-storage-import-fixture.cjs <case-path> <seed|import> [failure-boundary]')
}
if (failureBoundary && !failureBoundaries.includes(failureBoundary)) {
  throw new Error(`Unknown failure boundary: ${failureBoundary}`)
}

const paths = {
  profile: join(casePath, 'profile'),
  temp: join(casePath, 'temp'),
  logs: join(casePath, 'logs'),
  traces: join(casePath, 'traces'),
  crashes: join(casePath, 'crashes'),
}

for (const path of Object.values(paths)) {
  mkdirSync(path, { recursive: true })
}

app.setPath('userData', paths.profile)
app.setPath('temp', paths.temp)
app.setPath('crashDumps', paths.crashes)
app.setAppLogsPath(paths.logs)

const tracePath = join(paths.traces, 'safe-storage-import.ndjson')

function trace(event, details = {}) {
  appendFileSync(tracePath, `${JSON.stringify({ event, ...details })}\n`, { mode: 0o600 })
}

function report(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

function encryptionBackend() {
  if (process.env.TERMINAY_SAFE_STORAGE_PROOF_BACKEND) {
    return process.env.TERMINAY_SAFE_STORAGE_PROOF_BACKEND
  }
  return process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function'
    ? safeStorage.getSelectedStorageBackend()
    : process.platform
}

function protectorStatus() {
  const effectivePlatform =
    process.env.TERMINAY_SAFE_STORAGE_PROOF_PLATFORM || process.platform
  const backend = encryptionBackend()
  if (effectivePlatform === 'linux' && backend === 'basic_text') {
    return {
      available: safeStorage.isEncryptionAvailable(),
      backend,
      secure: false,
      reason: 'insecure-basic-text-backend',
    }
  }

  if (!safeStorage.isEncryptionAvailable()) {
    return {
      available: false,
      backend,
      secure: false,
      reason: 'safe-storage-unavailable',
    }
  }

  return { available: true, backend, secure: true }
}

function failAt(boundary) {
  if (failureBoundary !== boundary) {
    return
  }
  trace('failure-injected', { boundary })
  process.kill(process.pid, 'SIGKILL')
}

function encryptVaultValue(value, key, serverId, secretId) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(Buffer.from(`${serverId}:${secretId}:1`))
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return {
    ciphertext: ciphertext.toString('base64url'),
    nonce: nonce.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
  }
}

function decryptVaultValue(entry, key, serverId) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(entry.nonce, 'base64url'),
  )
  decipher.setAAD(Buffer.from(`${serverId}:${entry.id}:1`))
  decipher.setAuthTag(Buffer.from(entry.tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(entry.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

function openDatabase() {
  const database = new DatabaseSync(join(paths.profile, 'server-state.sqlite'))
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS vault_entries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      nonce TEXT NOT NULL,
      tag TEXT NOT NULL,
      ciphertext TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vault_keys (
      id TEXT PRIMARY KEY,
      wrapped_key BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS legacy_imports (
      source TEXT PRIMARY KEY,
      status TEXT NOT NULL
    );
  `)
  return database
}

function inspectCommittedState(database) {
  const entries = database
    .prepare('SELECT id, name, nonce, tag, ciphertext FROM vault_entries ORDER BY id')
    .all()
    .map((entry) => ({ ...entry }))
  const keys = database.prepare('SELECT id, wrapped_key FROM vault_keys ORDER BY id').all()
  const imports = database
    .prepare('SELECT source, status FROM legacy_imports ORDER BY source')
    .all()
    .map((entry) => ({ ...entry }))

  let secretMatches = false
  if (entries.length === 1 && keys.length === 1) {
    const rawKey = safeStorage.decryptString(Buffer.from(keys[0].wrapped_key))
    const dataEncryptionKey = Buffer.from(rawKey, 'base64url')
    secretMatches =
      decryptVaultValue(entries[0], dataEncryptionKey, 'server-test') === sentinel
    dataEncryptionKey.fill(0)
  }

  return {
    entryCount: entries.length,
    imported: entries.map(({ id, name }) => ({ id, name })),
    keyCount: keys.length,
    importCount: imports.length,
    migration: imports[0] ?? null,
    secretMatches,
  }
}

function seedLegacySecret(status) {
  if (!status.secure) {
    trace('protector-rejected', { backend: status.backend, reason: status.reason })
    report({ action, ...status })
    return
  }

  const encryptedLegacyValue = safeStorage.encryptString(sentinel).toString('base64')
  writeFileSync(
    join(paths.profile, 'secrets.json'),
    JSON.stringify([
      {
        encryptedValue: encryptedLegacyValue,
        id: 'legacy-secret',
        name: 'Legacy secret',
      },
    ]),
    { mode: 0o600 },
  )
  trace('legacy-seeded', { backend: status.backend })
  report({ action, ...status })
}

function importLegacySecret(status) {
  if (!status.secure) {
    trace('protector-rejected', { backend: status.backend, reason: status.reason })
    report({ action, ...status })
    return
  }

  const database = openDatabase()
  const existingImport = database
    .prepare('SELECT source, status FROM legacy_imports WHERE source = ?')
    .get(source)

  if (existingImport?.status === 'complete') {
    const state = inspectCommittedState(database)
    database.close()
    trace('import-already-complete')
    report({ action, ...status, importedThisRun: false, state })
    return
  }

  const legacy = JSON.parse(readFileSync(join(paths.profile, 'secrets.json'), 'utf8'))
  trace('source-read')
  failAt('source-read')

  const plaintext = safeStorage.decryptString(Buffer.from(legacy[0].encryptedValue, 'base64'))
  trace('legacy-decrypted')
  failAt('legacy-decrypted')

  const dataEncryptionKey = randomBytes(32)
  const encryptedVaultValue = encryptVaultValue(
    plaintext,
    dataEncryptionKey,
    'server-test',
    'legacy-secret',
  )
  trace('vault-encrypted')
  failAt('vault-encrypted')

  const wrappedDataEncryptionKey = safeStorage.encryptString(
    dataEncryptionKey.toString('base64url'),
  )
  dataEncryptionKey.fill(0)
  trace('key-wrapped')
  failAt('key-wrapped')

  database.exec('BEGIN IMMEDIATE')
  trace('transaction-begun')
  failAt('transaction-begun')

  database
    .prepare('INSERT INTO vault_entries (id, name, nonce, tag, ciphertext) VALUES (?, ?, ?, ?, ?)')
    .run(
      'legacy-secret',
      'Legacy secret',
      encryptedVaultValue.nonce,
      encryptedVaultValue.tag,
      encryptedVaultValue.ciphertext,
    )
  trace('entry-written')
  failAt('entry-written')

  database
    .prepare('INSERT INTO vault_keys (id, wrapped_key) VALUES (?, ?)')
    .run('active', wrappedDataEncryptionKey)
  trace('key-written')
  failAt('key-written')

  database
    .prepare('INSERT INTO legacy_imports (source, status) VALUES (?, ?)')
    .run(source, 'complete')
  trace('ledger-written')
  failAt('ledger-written')

  database.exec('COMMIT')
  trace('transaction-committed')
  failAt('transaction-committed')

  const state = inspectCommittedState(database)
  database.close()
  report({ action, ...status, importedThisRun: true, state })
}

app
  .whenReady()
  .then(() => {
    const status = protectorStatus()
    if (action === 'seed') {
      seedLegacySecret(status)
    } else {
      importLegacySecret(status)
    }
    app.quit()
  })
  .catch((error) => {
    trace('fixture-error', { message: error instanceof Error ? error.message : String(error) })
    throw error
  })
