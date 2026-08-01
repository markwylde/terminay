import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function required(name, value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is required.`)
  }
  return value
}

function parseArgs(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('Expected --target <linux-x64|linux-arm64> --artifact <path> --output <path>.')
    }
    values.set(key, value)
  }
  const target = required('--target', values.get('--target'))
  if (target !== 'linux-x64' && target !== 'linux-arm64') {
    throw new Error('--target must be linux-x64 or linux-arm64.')
  }
  return {
    artifact: required('--artifact', values.get('--artifact')),
    output: required('--output', values.get('--output')),
    target,
  }
}

async function gitCommit() {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
  const commit = stdout.trim()
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error('git HEAD was not a full commit SHA.')
  return commit
}

export async function assertCleanWorktreeExceptArtifact(
  artifact,
  { cwd = process.cwd() } = {},
) {
  const { stdout } = await execFileAsync(
    'git',
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    { cwd, encoding: 'utf8' },
  )
  const allowedArtifact = resolve(cwd, artifact)
  const entries = stdout.split('\0').filter(Boolean)
  const dirty = entries.some((entry) =>
    !entry.startsWith('?? ') || resolve(cwd, entry.slice(3)) !== allowedArtifact
  )
  if (dirty) {
    throw new Error('Native runner evidence requires a clean worktree.')
  }
}

async function unameMachine() {
  const { stdout } = await execFileAsync('uname', ['-m'], { encoding: 'utf8' })
  return stdout.trim()
}

export function validateNativeRunnerIdentity({ nodeArch, platform, runnerArch, target, uname }) {
  const expected = target === 'linux-x64'
    ? { node: 'x64', runner: 'X64', uname: 'x86_64' }
    : target === 'linux-arm64'
      ? { node: 'arm64', runner: 'ARM64', uname: 'aarch64' }
      : null
  if (!expected) throw new Error('--target must be linux-x64 or linux-arm64.')
  if (platform !== 'linux' || nodeArch !== expected.node || runnerArch !== expected.runner || uname !== expected.uname) {
    throw new Error(`Native runner identity does not match ${target}.`)
  }
  return expected
}

export async function verifiedArtifactDigest(artifact) {
  const path = required('artifact', artifact)
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Native runner artifact must be a regular non-symlink file.')
  const bytes = await readFile(path)
  return {
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)
}

function isCommit(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value)
}

async function readRegularJson(pathname, label) {
  const stat = await lstat(pathname)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file.`)
  }
  try {
    return JSON.parse(await readFile(pathname, 'utf8'))
  } catch {
    throw new Error(`${label} must contain valid JSON.`)
  }
}

/**
 * Validates a native runner record only when it proves the exact regular
 * archive and immutable source revision a release intends to publish. This
 * deliberately validates evidence after artifact download rather than
 * trusting the CI artifact name or the runner's uploaded JSON alone.
 */
export async function verifyNativeRunnerEvidence({ artifact, evidencePath, expectedCommit, target }) {
  const expectedTarget = required('target', target)
  if (expectedTarget !== 'linux-x64' && expectedTarget !== 'linux-arm64') {
    throw new Error('target must be linux-x64 or linux-arm64.')
  }
  if (!isCommit(expectedCommit)) throw new Error('expectedCommit must be a full lowercase commit SHA.')
  const evidence = await readRegularJson(required('evidencePath', evidencePath), 'Native runner evidence')
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('Native runner evidence must be an object.')
  }
  if (evidence.schemaVersion !== 1) throw new Error('Native runner evidence schemaVersion is unsupported.')
  if (evidence.target !== expectedTarget) throw new Error('Native runner evidence target does not match the expected target.')
  if (evidence.commit !== expectedCommit) throw new Error('Native runner evidence commit does not match the immutable release commit.')
  if (evidence.repository?.clean !== true) {
    throw new Error('Native runner evidence does not prove a clean worktree.')
  }
  const expectedIdentity = validateNativeRunnerIdentity({
    nodeArch: evidence.node?.arch,
    platform: evidence.runner?.os === 'Linux' ? 'linux' : undefined,
    runnerArch: evidence.runner?.arch,
    target: expectedTarget,
    uname: evidence.uname,
  })
  if (evidence.node?.version === undefined || !/^v\d+\.\d+\.\d+(?:[-+].+)?$/u.test(evidence.node.version)) {
    throw new Error('Native runner evidence must record a valid Node version.')
  }
  if (!Number.isSafeInteger(evidence.artifact?.bytes) || evidence.artifact.bytes < 0 || !isSha256(evidence.artifact?.sha256)) {
    throw new Error('Native runner evidence artifact digest is invalid.')
  }
  const actualArtifact = await verifiedArtifactDigest(required('artifact', artifact))
  if (actualArtifact.bytes !== evidence.artifact.bytes || actualArtifact.sha256 !== evidence.artifact.sha256) {
    throw new Error('Native runner evidence artifact does not match the exact archive bytes.')
  }
  return { artifact: actualArtifact, commit: evidence.commit, identity: expectedIdentity, target: expectedTarget }
}

export async function recordNativeRunnerEvidence({ artifact, output, target, environment = process.env } = {}) {
  required('output', output)
  required('target', target)
  const runnerArch = required('RUNNER_ARCH', environment.RUNNER_ARCH)
  const machine = await unameMachine()
  validateNativeRunnerIdentity({ nodeArch: process.arch, platform: process.platform, runnerArch, target, uname: machine })
  await assertCleanWorktreeExceptArtifact(artifact)
  const evidence = {
    artifact: await verifiedArtifactDigest(artifact),
    commit: await gitCommit(),
    node: { arch: process.arch, version: process.version },
    runner: { arch: runnerArch, os: required('RUNNER_OS', environment.RUNNER_OS) },
    repository: { clean: true },
    schemaVersion: 1,
    target,
    uname: machine,
  }
  const destination = resolve(output)
  await mkdir(dirname(destination), { recursive: true })
  const temporary = `${destination}.tmp-${process.pid}`
  await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, destination)
  return evidence
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  const { artifact, output, target } = parseArgs(process.argv.slice(2))
  recordNativeRunnerEvidence({ artifact, output, target }).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
