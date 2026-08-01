import { createHash } from 'node:crypto'
import { chmod, lstat, readdir, readFile, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { relative, sep } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

export async function assertSha256(path, expected, label = 'file') {
  const actual = await sha256File(path)
  if (actual !== expected) throw new Error(`${label} SHA-256 is ${actual}; expected ${expected}.`)
}

/** Reject links and special files; artifact payloads must be self-contained. */
export async function walkRegularTree(root) {
  const output = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`
      const details = await lstat(path)
      if (details.isSymbolicLink()) throw new Error(`artifact payload contains a symbolic link: ${path}`)
      if (details.isDirectory()) {
        output.push({ kind: 'directory', path })
        await visit(path)
      } else if (details.isFile()) {
        output.push({ kind: 'file', path })
      } else {
        throw new Error(`artifact payload contains a non-regular entry: ${path}`)
      }
    }
  }
  await visit(root)
  return output.sort((left, right) => left.path.localeCompare(right.path))
}

export async function normalizeArtifactModes(root, executablePaths = new Set()) {
  for (const entry of await walkRegularTree(root)) {
    if (entry.kind === 'directory') await chmod(entry.path, 0o755)
    else await chmod(entry.path, executablePaths.has(entry.path) ? 0o755 : 0o644)
  }
}

export async function describeArtifactFiles(root) {
  const files = []
  for (const entry of await walkRegularTree(root)) {
    if (entry.kind !== 'file') continue
    const path = relative(root, entry.path).split(sep).join('/')
    assertSafeArtifactPath(path)
    const details = await stat(entry.path)
    files.push({
      path,
      mode: (details.mode & 0o777).toString(8).padStart(3, '0'),
      size: details.size,
      sha256: await sha256File(entry.path),
    })
  }
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

export async function createDeterministicTarGz({ archivePath, rootName, stagingDirectory }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(rootName)) throw new Error('artifact root name is unsafe')
  const tarPath = archivePath.endsWith('.gz') ? archivePath.slice(0, -3) : `${archivePath}.tar`
  await execFileAsync('tar', [
    '--format=gnu', '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
    '-cf', tarPath, '-C', stagingDirectory, rootName,
  ])
  await execFileAsync('gzip', ['-n', '-9', tarPath])
  return archivePath.endsWith('.gz') ? archivePath : `${tarPath}.gz`
}

export async function assertElfArchitecture(path, expectedMachine, label = 'binary') {
  const bytes = await readFile(path)
  if (bytes.length < 20 || bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46) {
    throw new Error(`${label} is not an ELF binary: ${path}`)
  }
  const machine = bytes[5] === 1 ? bytes.readUInt16LE(18) : bytes.readUInt16BE(18)
  if (machine !== expectedMachine) throw new Error(`${label} ELF machine is ${machine}; expected ${expectedMachine}.`)
}

export function assertSafeArtifactPath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => part === '' || part === '.' || part === '..')) {
    throw new Error(`artifact path is unsafe: ${String(path)}`)
  }
}
