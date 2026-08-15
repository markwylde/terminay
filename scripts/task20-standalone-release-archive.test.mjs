import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'

const repositoryRoot = new URL('..', import.meta.url)

function run(command, args, { cwd = new URL('.', repositoryRoot).pathname } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}: ${stderr}`))
    })
  })
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function assertSafeArchivePath(path) {
  assert.ok(path === 'package' || path.startsWith('package/'), `archive entry must stay below package/: ${path}`)
  assert.ok(!path.includes('\\') && !path.includes('\0'), `archive entry must use a safe POSIX path: ${path}`)
  assert.ok(!path.split('/').includes('..'), `archive entry must not traverse parents: ${path}`)
}

test('standalone release archive contains only safe regular package entries and its integrity manifest binds every declared dist payload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminay-task20-standalone-release-'))
  try {
    const pack = Object.values(JSON.parse((await run('npm', [
      'pack', '--workspace', '@terminay/server', '--json', '--pack-destination', root,
    ])).stdout))
    assert.equal(pack.length, 1, 'release packaging must yield exactly one archive')
    const archive = join(root, pack[0].filename)

    const { stdout: listed } = await run('tar', ['-tzf', archive])
    const paths = listed.trim().split('\n').filter(Boolean)
    assert.ok(paths.length > 0, 'release archive must not be empty')
    assert.equal(new Set(paths).size, paths.length, 'release archive must not contain duplicate paths')
    for (const path of paths) assertSafeArchivePath(path)

    const { stdout: verboseListing } = await run('tar', ['-tvzf', archive])
    const rows = verboseListing.trim().split('\n').filter(Boolean)
    assert.equal(rows.length, paths.length, 'verbose archive listing must account for every entry')
    for (const row of rows) {
      const mode = row.slice(0, 10)
      assert.ok(mode[0] === '-' || mode[0] === 'd', `archive must reject link/device/special entry: ${row}`)
      assert.notEqual(mode[5], 'w', `archive entry must not be group-writable: ${row}`)
      assert.notEqual(mode[8], 'w', `archive entry must not be world-writable: ${row}`)
    }

    const packageJson = JSON.parse((await run('tar', ['-xOzf', archive, 'package/package.json'])).stdout)
    const integrity = JSON.parse((await run('tar', ['-xOzf', archive, 'package/dist/release-integrity.json'])).stdout)
    assert.equal(integrity.schemaVersion, 1)
    assert.equal(integrity.packageName, '@terminay/server')
    assert.equal(integrity.version, packageJson.version, 'integrity descriptor version must match the packed package')
    assert.ok(Array.isArray(integrity.files) && integrity.files.length > 0, 'integrity descriptor must declare payload files')

    for (const descriptor of integrity.files) {
      assert.equal(typeof descriptor.path, 'string')
      assert.match(descriptor.path, /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u)
      assert.ok(Number.isSafeInteger(descriptor.size) && descriptor.size >= 0)
      assert.match(descriptor.sha256, /^[a-f0-9]{64}$/u)
      const packedPath = `package/dist/${descriptor.path}`
      assert.ok(paths.includes(packedPath), `integrity descriptor must reference a packed payload: ${packedPath}`)
      const bytes = Buffer.from((await run('tar', ['-xOzf', archive, packedPath])).stdout)
      assert.equal(bytes.byteLength, descriptor.size, `integrity size must bind ${packedPath}`)
      assert.equal(sha256(bytes), descriptor.sha256, `integrity hash must bind ${packedPath}`)
    }

    // The descriptor itself and the independently executable CLI entrypoint
    // are release-critical; pin their presence rather than allowing a
    // truncated archive to pass based only on a subset of declared payloads.
    for (const path of ['package/dist/release-integrity.json', 'package/dist/cli.js']) {
      assert.ok(paths.includes(path), `release archive must contain ${path}`)
    }
    assert.equal((await readFile(archive)).byteLength, pack[0].size, 'npm pack metadata must describe the exact archive bytes')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
