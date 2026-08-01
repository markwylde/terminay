#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { assertElfArchitecture, assertSafeArtifactPath, describeArtifactFiles, sha256File, walkRegularTree } from './artifact-determinism.mjs'
import { getPtyRuntimePlatform, PTY_RUNTIME_NODE_VERSION } from './pty-runtime-platforms.mjs'

const execFileAsync = promisify(execFile)

/**
 * Exercise a release archive after extraction on its native Linux runner.
 * This deliberately never tries to execute Linux ELF binaries on a developer
 * machine: callers must run it on Linux with the matching CPU architecture.
 */
export async function probeStandaloneServerArchive({ archivePath, target = nativeTarget() }) {
  if (process.platform !== 'linux') throw new Error('Standalone archive execution requires native Linux.')
  const platform = getPtyRuntimePlatform(target)
  if (process.arch !== platform.architecture) {
    throw new Error(`${target} archive requires native ${platform.architecture}; this runner is ${process.arch}.`)
  }

  const archive = resolve(archivePath)
  const temporary = await mkdtemp(join(tmpdir(), 'terminay-standalone-archive-probe-'))
  try {
    const rootName = await inspectArchiveIndex(archive, target)
    await execFileAsync('tar', ['-xzf', archive, '--no-same-owner', '--no-same-permissions', '-C', temporary])
    const root = join(temporary, rootName)
    const manifest = await validateExtractedArchive(root, target)
    const version = await executeVersion(root)
    return Object.freeze({
      archive: basename(archive),
      archiveSha256: await sha256File(archive),
      target,
      version,
      fileCount: manifest.files.length,
    })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

/** Validate tar member names before extraction and return the one root name. */
export async function inspectArchiveIndex(archivePath, target) {
  getPtyRuntimePlatform(target)
  const { stdout } = await execFileAsync('tar', ['-tzf', archivePath], { maxBuffer: 16 * 1024 * 1024 })
  const members = stdout.split('\n').filter(Boolean)
  if (members.length === 0) throw new Error('standalone archive is empty')
  const roots = new Set()
  for (const member of members) {
    const normalized = member.endsWith('/') ? member.slice(0, -1) : member
    assertSafeArtifactPath(normalized)
    roots.add(normalized.split('/')[0])
  }
  if (roots.size !== 1) throw new Error('standalone archive must contain exactly one root directory')
  const [rootName] = roots
  const expected = `terminay-server-node${PTY_RUNTIME_NODE_VERSION}-${target}`
  if (rootName !== expected) throw new Error(`standalone archive root must be ${expected}`)
  const verbose = await execFileAsync('tar', ['-tvzf', archivePath], { maxBuffer: 16 * 1024 * 1024 })
  for (const line of verbose.stdout.split('\n').filter(Boolean)) {
    // A release archive is an all-regular payload. Refuse links and special
    // files before extraction, so a malicious archive cannot redirect a later
    // member outside the temporary directory.
    if (line[0] !== '-' && line[0] !== 'd') throw new Error('standalone archive contains a non-regular tar member')
  }
  return rootName
}

/** Validate the manifest against all extracted regular files before execution. */
export async function validateExtractedArchive(root, target) {
  const platform = getPtyRuntimePlatform(target)
  const entries = await walkRegularTree(root)
  const files = await describeArtifactFiles(root)
  const manifestPath = join(root, 'artifact-manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (manifest.schemaVersion !== 1 || manifest.artifact !== 'terminay-server' || manifest.target !== target) {
    throw new Error('standalone archive manifest identity is invalid')
  }
  if (manifest.node?.version !== PTY_RUNTIME_NODE_VERSION || manifest.nodePty?.nativePath !== 'node_modules/node-pty/build/Release/pty.node') {
    throw new Error('standalone archive manifest runtime metadata is invalid')
  }
  if (manifest.entrypoints?.server !== 'bin/terminay-server' || manifest.entrypoints?.mcp !== 'bin/terminay-mcp') {
    throw new Error('standalone archive manifest entrypoints are invalid')
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('standalone archive manifest has no files')

  const actual = new Map(files.filter((file) => file.path !== 'artifact-manifest.json').map((file) => [file.path, file]))
  const declared = new Map(manifest.files.map((file) => [file.path, file]))
  if (actual.size !== declared.size || [...actual.keys()].some((path) => !declared.has(path))) {
    throw new Error('standalone archive payload does not match its manifest inventory')
  }
  for (const [path, expected] of declared) {
    assertSafeArtifactPath(path)
    const received = actual.get(path)
    if (!received || received.sha256 !== expected.sha256 || received.size !== expected.size || received.mode !== expected.mode) {
      throw new Error(`standalone archive manifest mismatch: ${path}`)
    }
  }
  if (!entries.some((entry) => entry.kind === 'file' && relative(root, entry.path) === 'bin/terminay-server')) {
    throw new Error('standalone archive server launcher is missing')
  }
  await assertElfArchitecture(join(root, 'bin', 'node'), platform.elfMachine, 'archive Node runtime')
  await assertElfArchitecture(join(root, 'node_modules', 'node-pty', 'build', 'Release', 'pty.node'), platform.elfMachine, 'archive node-pty')
  return manifest
}

async function executeVersion(root) {
  const { stdout, stderr } = await execFileAsync(join(root, 'bin', 'terminay-server'), ['--version'], {
    cwd: root,
    timeout: 10_000,
    maxBuffer: 64 * 1024,
  })
  if (stderr !== '') throw new Error('standalone archive version command wrote to stderr')
  const version = stdout.trim()
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) throw new Error('standalone archive returned an invalid version')
  return version
}

function nativeTarget() {
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) {
    throw new Error('target is required outside native supported Linux')
  }
  return `linux-${process.arch}`
}

function parseArgs(values) {
  const args = {}
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]
    const value = values[index + 1]
    if (!key?.startsWith('--') || value === undefined) throw new Error('expected --archive path and optional --target target')
    args[key.slice(2)] = value
  }
  if (!args.archive || Object.keys(args).some((key) => key !== 'archive' && key !== 'target')) throw new Error('expected --archive path and optional --target target')
  return args
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const args = parseArgs(process.argv.slice(2))
  const result = await probeStandaloneServerArchive({ archivePath: args.archive, target: args.target })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
