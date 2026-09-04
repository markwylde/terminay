import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const NATIVE_NAME = /(?:^|[-/@])(electron|node-pty|node-datachannel|wrtc|werift|esbuild)(?:$|[-/@])/iu
const INTEGRITY = /^(sha256|sha384|sha512)-[A-Za-z0-9+/=]+$/u

export async function auditSupplyChain(root = process.cwd(), options = {}) {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const lockfile = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
  assertRoot(packageJson, lockfile)
  const entries = []
  const unresolved = { integrity: [], license: [], manifest: [] }
  const native = []

  for (const [path, lockEntry] of Object.entries(lockfile.packages ?? {})) {
    if (path === '') continue
    if (isWorkspacePath(path) || lockEntry.link === true) {
      entries.push({ path, name: lockEntry.name ?? packageNameFromPath(path), version: lockEntry.version ?? 'workspace', source: 'workspace' })
      continue
    }

    const name = lockEntry.name ?? packageNameFromPath(path)
    const manifest = await readInstalledManifest(root, path)
    const license = normalizeLicense(manifest?.license ?? manifest?.licenses ?? lockEntry.license)
    const bundleOwner = lockEntry.inBundle === true ? findBundleOwner(lockfile.packages, path) : null
    const record = {
      path,
      name,
      version: lockEntry.version ?? manifest?.version ?? 'unknown',
      resolved: bundleOwner?.resolved ?? (typeof lockEntry.resolved === 'string' ? lockEntry.resolved : null),
      integrity: bundleOwner?.integrity ?? (typeof lockEntry.integrity === 'string' ? lockEntry.integrity : null),
      license: license ?? null,
      source: bundleOwner === null ? 'registry' : 'bundled',
      ...(bundleOwner === null ? {} : { bundleOwner: bundleOwner.path }),
    }
    entries.push(record)
    if (record.resolved === null || record.integrity === null || !INTEGRITY.test(record.integrity)) unresolved.integrity.push(path)
    if (record.license === null) unresolved.license.push(path)
    if (manifest === null) unresolved.manifest.push(path)
    if (NATIVE_NAME.test(name)) native.push({ name, version: record.version, resolved: record.resolved, integrity: record.integrity, license: record.license })
  }

  entries.sort((left, right) => left.path.localeCompare(right.path))
  native.sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`))
  const report = {
    schemaVersion: 1,
    product: packageJson.name,
    version: packageJson.version,
    lockfileVersion: lockfile.lockfileVersion,
    dependencyCount: entries.length,
    downloadedDependencyCount: entries.filter((entry) => entry.source === 'registry').length,
    unresolved,
    native,
    sbom: createSpdx(entries, packageJson.name),
    limitations: [
      'dependency vulnerability advisories are tracked by Dependabot, not by this report',
      'native package metadata records npm provenance but does not establish signed binary provenance or ABI execution on every release architecture',
      'license declarations are package metadata; release publication still needs the corresponding license texts and notices',
    ],
  }
  if (options.failOnUnresolved !== false && (unresolved.integrity.length > 0 || unresolved.license.length > 0)) {
    throw new Error(`supply-chain metadata is incomplete: ${JSON.stringify(unresolved)}`)
  }
  return report
}

export function createSpdx(entries, product) {
  const packages = entries.map((entry) => ({
    SPDXID: `SPDXRef-${sha256(entry.path).slice(0, 16)}`,
    name: entry.name,
    versionInfo: entry.version,
    downloadLocation: entry.resolved ?? 'NOASSERTION',
    licenseConcluded: entry.license ?? 'NOASSERTION',
    licenseDeclared: entry.license ?? 'NOASSERTION',
    ...(entry.integrity === null ? {} : { externalRefs: [{ referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl', referenceLocator: entry.resolved ?? `pkg:npm/${entry.name}@${entry.version}` }] }),
  }))
  return {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: product,
    documentNamespace: `https://terminay.dev/sbom/task20/${sha256(JSON.stringify(packages))}`,
    packages,
  }
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function readInstalledManifest(root, lockPath) {
  if (!lockPath.startsWith('node_modules/')) return null
  try {
    return JSON.parse(await readFile(join(root, lockPath, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

function normalizeLicense(value) {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  if (Array.isArray(value)) {
    const values = value.map((item) => (typeof item === 'string' ? item.trim() : item?.type)).filter((item) => typeof item === 'string' && item.length > 0)
    return values.length > 0 ? values.join(' OR ') : null
  }
  if (value && typeof value === 'object' && typeof value.type === 'string' && value.type.trim().length > 0) return value.type.trim()
  return null
}

function packageNameFromPath(path) {
  const parts = path.split('/')
  const index = parts.lastIndexOf('node_modules')
  if (index < 0 || parts[index + 1] === undefined) return path
  return parts[index + 1].startsWith('@') ? `${parts[index + 1]}/${parts[index + 2] ?? ''}` : parts[index + 1]
}

function isWorkspacePath(path) {
  return /^(?:apps|packages|extensions)\/[^/]+$/u.test(path)
}

function findBundleOwner(packages, path) {
  let boundary = path.lastIndexOf('/node_modules/')
  while (boundary > 0) {
    const ownerPath = path.slice(0, boundary)
    const owner = packages?.[ownerPath]
    if (
      Array.isArray(owner?.bundleDependencies) &&
      typeof owner.resolved === 'string' &&
      typeof owner.integrity === 'string' &&
      INTEGRITY.test(owner.integrity)
    ) {
      return { path: ownerPath, resolved: owner.resolved, integrity: owner.integrity }
    }
    boundary = ownerPath.lastIndexOf('/node_modules/')
  }
  return null
}

function assertRoot(packageJson, lockfile) {
  if (lockfile.lockfileVersion !== 3) throw new Error('package-lock.json must use lockfileVersion 3')
  if (lockfile.packages?.['']?.name !== packageJson.name) throw new Error('lockfile root name does not match package.json')
  if (lockfile.packages?.['']?.version !== packageJson.version) throw new Error('lockfile root version does not match package.json')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const output = await auditSupplyChain(process.cwd())
  const outputPath = process.env.TERMINAY_SUPPLY_CHAIN_REPORT
  if (outputPath) await writeFile(resolve(outputPath), `${JSON.stringify(output, null, 2)}\n`)
  console.log(JSON.stringify({ product: output.product, version: output.version, dependencyCount: output.dependencyCount, nativeCount: output.native.length }))
}
