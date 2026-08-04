import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'

const sentinel = Buffer.from('terminay-safe-storage-import-sentinel')
const scriptsDirectory = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(scriptsDirectory, 'safe-storage-import-fixture.cjs')
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

async function listFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath)))
    } else if (entry.isFile()) {
      files.push(entryPath)
    } else if (entry.isSymbolicLink()) {
      assert.fail(`Unexpected symbolic link in isolated migration area: ${entryPath}`)
    }
  }
  return files
}

async function runFixture(casePath, action, failureBoundary = null, environment = {}) {
  await mkdir(join(casePath, 'temp'), { recursive: true })
  return new Promise((resolve, reject) => {
    const child = spawn(
      electronPath,
      [fixturePath, casePath, action, ...(failureBoundary ? [failureBoundary] : [])],
      {
        env: {
          ...process.env,
          ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
          TMPDIR: join(casePath, 'temp'),
          TMP: join(casePath, 'temp'),
          TEMP: join(casePath, 'temp'),
          ...environment,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      const lines = stdout
        .trim()
        .split('\n')
        .filter(Boolean)
      const result = lines.length > 0 ? JSON.parse(lines.at(-1)) : null
      resolve({ code, signal, stderr, result })
    })
  })
}

function fileContains(file, needle) {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(file)
    let carry = Buffer.alloc(0)
    let settled = false
    const finish = (result) => {
      if (settled) {
        return
      }
      settled = true
      resolve(result)
    }
    stream.on('data', (chunk) => {
      const content = Buffer.concat([carry, chunk])
      if (content.includes(needle)) {
        stream.destroy()
        finish(true)
        return
      }
      carry = content.subarray(Math.max(0, content.length - needle.length + 1))
    })
    stream.on('error', reject)
    stream.on('close', () => finish(false))
    stream.on('end', () => finish(false))
  })
}

async function assertNoPlaintextArtifacts(casePath, phase) {
  const files = await listFiles(casePath)
  assert.equal(files.length > 0, true, `${phase}: isolated migration area is empty`)
  for (const file of files) {
    assert.equal(
      await fileContains(file, sentinel),
      false,
      `${phase}: plaintext sentinel leaked into ${file}`,
    )
  }
}

function assertSuccessfulImport(result, importedThisRun) {
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.signal, null)
  assert.equal(result.result.secure, true)
  assert.equal(result.result.importedThisRun, importedThisRun)
  assert.deepEqual(result.result.state.imported, [
    { id: 'legacy-secret', name: 'Legacy secret' },
  ])
  assert.deepEqual(result.result.state.migration, {
    source: 'electron-safe-storage',
    status: 'complete',
  })
  assert.equal(result.result.state.entryCount, 1)
  assert.equal(result.result.state.keyCount, 1)
  assert.equal(result.result.state.importCount, 1)
  assert.equal(result.result.state.secretMatches, true)
}

test('Electron safeStorage import recovers idempotently from every migration boundary', async (t) => {
  const suitePath = await mkdtemp(join(tmpdir(), 'terminay-safe-storage-import-'))
  try {
    for (const boundary of failureBoundaries) {
      await t.test(boundary, async (t) => {
        const casePath = join(suitePath, boundary)
        const seeded = await runFixture(casePath, 'seed')

        if (seeded.result?.available === false) {
          t.skip('Electron safeStorage is unavailable on this host.')
          return
        }
        if (
          process.platform === 'linux' &&
          seeded.result?.backend === 'basic_text'
        ) {
          assert.equal(seeded.code, 0, seeded.stderr)
          assert.deepEqual(
            {
              secure: seeded.result.secure,
              reason: seeded.result.reason,
            },
            {
              secure: false,
              reason: 'insecure-basic-text-backend',
            },
          )
          await assertNoPlaintextArtifacts(casePath, `${boundary}: rejected protector`)
          t.skip('Linux basic_text was correctly rejected as an insecure key protector.')
          return
        }

        assert.equal(seeded.code, 0, seeded.stderr)
        assert.equal(seeded.result?.secure, true)
        await assertNoPlaintextArtifacts(casePath, `${boundary}: seed`)

        const failed = await runFixture(casePath, 'import', boundary)
        assert.equal(failed.code, null)
        assert.equal(failed.signal, 'SIGKILL')
        assert.equal(failed.result, null)
        await assertNoPlaintextArtifacts(casePath, `${boundary}: injected failure`)

        const trace = await readFile(
          join(casePath, 'traces', 'safe-storage-import.ndjson'),
          'utf8',
        )
        assert.match(
          trace,
          new RegExp(
            `"event":"failure-injected","boundary":"${boundary}"`,
          ),
        )

        const recovered = await runFixture(casePath, 'import')
        assertSuccessfulImport(
          recovered,
          boundary !== 'transaction-committed',
        )
        await assertNoPlaintextArtifacts(casePath, `${boundary}: recovery`)

        const repeated = await runFixture(casePath, 'import')
        assertSuccessfulImport(repeated, false)
        await assertNoPlaintextArtifacts(casePath, `${boundary}: repeated recovery`)
      })
    }
  } finally {
    await rm(suitePath, { force: true, recursive: true })
  }
})

test('Linux basic_text is never accepted as a secure safeStorage protector', async () => {
  const casePath = await mkdtemp(join(tmpdir(), 'terminay-safe-storage-basic-text-'))
  try {
    const rejected = await runFixture(casePath, 'seed', null, {
      TERMINAY_SAFE_STORAGE_PROOF_BACKEND: 'basic_text',
      TERMINAY_SAFE_STORAGE_PROOF_PLATFORM: 'linux',
    })
    assert.equal(rejected.code, 0, rejected.stderr)
    assert.deepEqual(
      {
        backend: rejected.result.backend,
        secure: rejected.result.secure,
        reason: rejected.result.reason,
      },
      {
        backend: 'basic_text',
        secure: false,
        reason: 'insecure-basic-text-backend',
      },
    )

    const profileFiles = await listFiles(join(casePath, 'profile'))
    assert.equal(
      profileFiles.some((file) => file.endsWith('secrets.json')),
      false,
      'Rejected basic_text backend created a legacy secret.',
    )
    assert.equal(
      profileFiles.some((file) => file.endsWith('server-state.sqlite')),
      false,
      'Rejected basic_text backend created vault state.',
    )
    await assertNoPlaintextArtifacts(casePath, 'rejected Linux basic_text protector')
  } finally {
    await rm(casePath, { force: true, recursive: true })
  }
})
