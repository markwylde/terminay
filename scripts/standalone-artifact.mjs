import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'

const PACKAGE_NAME = '@terminay/server'
const REQUIRED_FILES = ['package.json', 'dist/cli.js', 'dist/index.js', 'dist/mcpEntry.js']
const NODE_ENGINE = '24.14.0'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function fail(message) {
  throw new Error(`standalone artifact validation failed: ${message}`)
}

async function readRegularFile(root, path) {
  const absolute = join(root, path)
  const info = await lstat(absolute).catch(() => undefined)
  if (info === undefined || !info.isFile()) fail(`required file is missing or not regular: ${path}`)
  const bytes = await readFile(absolute)
  return { bytes, size: info.size }
}

function assertSafeManifestPath(path) {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => part === '..' || part === '')) {
    fail(`manifest path is not a safe relative path: ${path}`)
  }
}

/**
 * Inspect the minimal standalone server payload without executing it. The
 * result is deterministic and contains hashes, not file contents or secrets.
 */
export async function inspectStandaloneArtifact(root) {
  const packageFile = await readRegularFile(root, 'package.json')
  let packageJson
  try {
    packageJson = JSON.parse(packageFile.bytes.toString('utf8'))
  } catch (error) {
    fail(`package.json is not valid JSON: ${error instanceof Error ? error.message : 'unknown error'}`)
  }

  if (packageJson?.name !== PACKAGE_NAME) fail(`package name must be ${PACKAGE_NAME}`)
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) fail('package version is missing')
  if (packageJson.engines?.node !== NODE_ENGINE) fail(`Node engine must be pinned to ${NODE_ENGINE}`)
  if (!Array.isArray(packageJson.files) || !packageJson.files.includes('dist')) fail('package files must include dist')
  if (packageJson.bin?.['terminay-server'] !== 'dist/cli.js') fail('terminay-server bin must point to dist/cli.js')
  if (packageJson.bin?.['terminay-mcp'] !== 'dist/mcpEntry.js') fail('terminay-mcp bin must point to dist/mcpEntry.js')

  const files = []
  for (const path of REQUIRED_FILES) {
    const file = path === 'package.json' ? packageFile : await readRegularFile(root, path)
    const normalizedPath = path.split(sep).join('/')
    assertSafeManifestPath(normalizedPath)
    files.push({ path: normalizedPath, size: file.size, sha256: sha256(file.bytes) })
  }

  for (const path of ['dist/cli.js', 'dist/index.js', 'dist/mcpEntry.js']) {
    const source = (await readFile(join(root, path), 'utf8'))
    if (/['"]electron(?:\/|['"])/u.test(source)) fail(`${path} imports Electron`)
  }

  return {
    schemaVersion: 1,
    artifact: 'terminay-server',
    package: { name: packageJson.name, version: packageJson.version, node: packageJson.engines.node },
    files,
    provenance: {
      generatedBy: 'scripts/standalone-artifact.mjs',
      packageManifest: 'package.json',
      lockfile: 'package-lock.json',
    },
  }
}

/** Write a deterministic payload manifest next to a standalone artifact. */
export async function writeStandaloneArtifactManifest(root, outputPath = join(root, 'artifact-manifest.json')) {
  const manifest = await inspectStandaloneArtifact(root)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

/**
 * Re-hash a payload and compare it with a previously generated manifest. This
 * intentionally does not verify signatures; release signing remains a later
 * gate and cannot be implied by this check.
 */
export async function validateStandaloneArtifact(root, manifest) {
  if (manifest === null || typeof manifest !== 'object' || manifest.schemaVersion !== 1 || manifest.artifact !== 'terminay-server') {
    fail('manifest schema or artifact name is invalid')
  }
  if (!Array.isArray(manifest.files) || manifest.files.length !== REQUIRED_FILES.length) fail('manifest file list is invalid')
  const expected = await inspectStandaloneArtifact(root)
  const expectedJson = JSON.stringify(expected)
  const actualJson = JSON.stringify({ ...manifest, provenance: expected.provenance })
  if (actualJson !== expectedJson) fail('manifest metadata or file hashes do not match the payload')
  return expected
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2]
  if (!root) fail('usage: node scripts/standalone-artifact.mjs <artifact-root> [manifest-path]')
  const outputPath = process.argv[3] ?? join(root, 'artifact-manifest.json')
  const manifest = await writeStandaloneArtifactManifest(root, outputPath)
  console.log(JSON.stringify({ artifact: manifest.artifact, version: manifest.package.version, files: manifest.files.length, outputPath }))
}
