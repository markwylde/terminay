import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { checkWorkspace } from './check-workspace-boundaries.mjs'

const _execFileAsync = promisify(execFile)

export async function inspectReleaseInputs(root = process.cwd()) {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const lockfile = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
  const webrtcRuntimeSelection = JSON.parse(
    await readFile(join(root, 'build', 'webrtc-runtime', 'selection.json'), 'utf8'),
  )
  assertSelectedWebRtcRuntime(webrtcRuntimeSelection)
  if (lockfile.lockfileVersion !== 3) throw new Error('package-lock.json must use lockfileVersion 3')
  if (lockfile.packages?.['']?.name !== packageJson.name) throw new Error('lockfile root package does not match package.json')
  if (lockfile.packages?.['']?.version !== packageJson.version) throw new Error('lockfile root version does not match package.json')
  const workspaces = []
  for (const pattern of packageJson.workspaces ?? []) {
    if (pattern !== 'apps/*' && pattern !== 'packages/*' && pattern !== 'extensions/*') continue
    const prefix = pattern.replace('/*', '')
    const names = Object.keys(lockfile.packages).filter((key) => key.startsWith(`${prefix}/`) && key.slice(prefix.length + 1).includes('/') === false)
    for (const key of names) workspaces.push(key)
  }
  const nativePackages = Object.keys(lockfile.packages)
    .map((key) => key.split('node_modules/').at(-1))
    .filter((name) => name && /(?:node-pty|node-datachannel|wrtc|werift|electron|esbuild)/iu.test(name))
    .sort()
  const boundary = checkWorkspace(root)
  const importBoundaryEvidence = createImportBoundaryEvidence(root, boundary)
  if (importBoundaryEvidence.violationCount > 0) {
    throw new Error(`workspace import boundary violations: ${importBoundaryEvidence.violationCount}`)
  }
  return {
    packageJson,
    lockfile,
    workspaces: [...new Set(workspaces)].sort(),
    nativePackages,
    webrtcRuntimeSelection,
    importBoundaryEvidence,
  }
}

export function createImportBoundaryEvidence(root, boundary) {
  const relativePath = (path) => path.startsWith(`${resolve(root)}/`) ? path.slice(resolve(root).length + 1).replaceAll('\\', '/') : path
  const packages = boundary.records
    .map((record) => ({
      name: record.name,
      kind: record.kind,
      source: relativePath(record.source),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
  const violations = boundary.violations
    .map((violation) => ({
      file: relativePath(violation.file),
      line: violation.line,
      column: violation.column,
      message: violation.message,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  const payload = {
    schemaVersion: 1,
    checker: 'scripts/check-workspace-boundaries.mjs',
    packages,
    violations,
  }
  return {
    ...payload,
    violationCount: violations.length,
    sha256: sha256(JSON.stringify(payload)),
  }
}

export function createSbom(inputs) {
  const packages = Object.entries(inputs.lockfile.packages ?? {})
    .filter(([path]) => path !== '')
    .map(([path, value]) => ({
      SPDXID: `SPDXRef-${sha256(path).slice(0, 16)}`,
      name: value.name ?? path.split('node_modules/').at(-1) ?? path,
      versionInfo: value.version ?? 'unknown',
      downloadLocation: value.resolved ?? 'NOASSERTION',
      licenseConcluded: typeof value.license === 'string' ? value.license : 'NOASSERTION',
      licenseDeclared: typeof value.license === 'string' ? value.license : 'NOASSERTION',
      supplier: 'NOASSERTION',
      ...(integrityChecksum(value.integrity) === undefined ? {} : { checksums: [integrityChecksum(value.integrity)] }),
    }))
    .sort((left, right) => `${left.name}@${left.versionInfo}`.localeCompare(`${right.name}@${right.versionInfo}`))
  return {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: inputs.packageJson.name,
    documentNamespace: `https://terminay.dev/sbom/${sha256(JSON.stringify(packages))}`,
    packages,
  }
}

/** Convert npm's integrity metadata into SPDX checksum evidence. Workspace
 * entries intentionally remain without a checksum because they are source
 * directories rather than downloaded archives. */
function integrityChecksum(integrity) {
  if (typeof integrity !== 'string') return undefined
  const match = /^(sha256|sha384|sha512)-([A-Za-z0-9+/=]+)$/.exec(integrity)
  if (match === null) return undefined
  const algorithm = match[1].toUpperCase()
  const checksumValue = Buffer.from(match[2], 'base64').toString('hex')
  if (checksumValue.length === 0) return undefined
  return { algorithm, checksumValue }
}

export function createReleaseManifest(inputs, sbom) {
  const sbomPackages = sbom.packages ?? []
  const integrityPackages = sbomPackages.filter((entry) => Array.isArray(entry.checksums) && entry.checksums.length > 0)
  const licensedPackages = sbomPackages.filter((entry) => entry.licenseDeclared !== 'NOASSERTION')
  return {
    schemaVersion: 1,
    product: inputs.packageJson.name,
    version: inputs.packageJson.version,
    lockfileVersion: inputs.lockfile.lockfileVersion,
    workspacePackages: inputs.workspaces,
    nativePackages: inputs.nativePackages,
    sbomSha256: sha256(JSON.stringify(sbom)),
    dependencyEvidence: {
      packageCount: sbomPackages.length,
      integrityCoverage: integrityPackages.length,
      licenseCoverage: licensedPackages.length,
      unresolvedIntegrity: sbomPackages.filter((entry) => !Array.isArray(entry.checksums) || entry.checksums.length === 0).map((entry) => entry.name),
      unresolvedLicense: sbomPackages.filter((entry) => entry.licenseDeclared === 'NOASSERTION').map((entry) => entry.name),
    },
    provenance: {
      lockfile: 'package-lock.json',
      nativeRuntime: 'scripts/build-standalone-server-artifact.mjs',
      webrtcRuntime: 'scripts/build-secure-werift-candidate.mjs',
      sourceCorrespondence: 'git commit and locked package manifest are required at release time',
    },
    webrtcRuntime: inputs.webrtcRuntimeSelection,
    importBoundaryEvidence: inputs.importBoundaryEvidence,
  }
}

function assertSelectedWebRtcRuntime(selection) {
  if (
    selection?.schemaVersion !== 1 ||
    selection.runtime !== 'secure-werift' ||
    selection.artifactFormat !== 'terminay-secure-werift-v1' ||
    selection.package?.name !== '@terminay/werift-runtime-proof' ||
    selection.package?.version !== '0.24.1-candidate.1' ||
    selection.upstream?.npmPackage !== 'werift@0.24.1' ||
    selection.upstream?.gitHead !== '243fd7e24c39fbe03fb855928daddd793fc8d4fa' ||
    !hasExactGovernedPatches(selection.patches) ||
    selection.integrity?.payloadManifest !== 'SHA256SUMS' ||
    selection.integrity?.rejectSymlinks !== true ||
    selection.integrity?.rejectExtraFiles !== true ||
    selection.runtimePolicy?.fallback !== 'disabled' ||
    selection.runtimePolicy?.legacyNodeDataChannelFallback !== false
  ) {
    throw new Error('selected WebRTC runtime manifest is invalid')
  }
}

/** The governed patch set, pinned by hash and by the order it is applied. */
const GOVERNED_WEBRTC_PATCH_SHA256 = Object.freeze([
  '34ea60bd991256adb2cd50bfe0ef9011cfc79054aff686b9ec35ef4703de4211',
  '298aa1ebb0f0eb45c673dd24907e7e8110bfef499524993d8203fd74ecaa6b2b',
])

function hasExactGovernedPatches(patches) {
  return (
    Array.isArray(patches) &&
    patches.length === GOVERNED_WEBRTC_PATCH_SHA256.length &&
    GOVERNED_WEBRTC_PATCH_SHA256.every((sha256, index) => patches[index]?.sha256 === sha256)
  )
}

export async function writeReleaseEvidence(root = process.cwd(), outputDir = join(root, '.release')) {
  const inputs = await inspectReleaseInputs(root)
  const sbom = createSbom(inputs)
  const manifest = createReleaseManifest(inputs, sbom)
  await mkdir(outputDir, { recursive: true })
  await writeFile(join(outputDir, 'sbom.spdx.json'), `${JSON.stringify(sbom, null, 2)}\n`)
  await writeFile(join(outputDir, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return { inputs, sbom, manifest, outputDir: resolve(outputDir) }
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.cwd()
  const evidence = await writeReleaseEvidence(root, process.env.TERMINAY_RELEASE_EVIDENCE_DIR ?? join(root, '.release'))
  console.log(JSON.stringify({ outputDir: evidence.outputDir, workspacePackages: evidence.inputs.workspaces.length, nativePackages: evidence.inputs.nativePackages.length, sbomSha256: evidence.manifest.sbomSha256 }))
}
