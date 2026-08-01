import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const rawVersion = process.argv[2]?.trim()

if (!rawVersion) {
  console.error('Missing target version argument')
  process.exit(1)
}

if (!/^\d+\.\d+\.\d+$/.test(rawVersion)) {
  console.error(`Invalid semantic version: ${rawVersion}`)
  process.exit(1)
}

const packageJsonPath = resolve(process.cwd(), 'package.json')
const packageLockPath = resolve(process.cwd(), 'package-lock.json')
const serverPackageJsonPath = resolve(process.cwd(), 'apps/terminay-server/package.json')

async function syncJsonVersion(filePath) {
  const raw = await readFile(filePath, 'utf8')
  const parsed = JSON.parse(raw)

  if (parsed.version === rawVersion) {
    return false
  }

  parsed.version = rawVersion

  for (const packagePath of ['', 'apps/terminay-server']) {
    if (parsed.packages?.[packagePath]) {
      parsed.packages[packagePath].version = rawVersion
    }
  }

  await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`)
  return true
}

const packageJsonChanged = await syncJsonVersion(packageJsonPath)
const packageLockChanged = await syncJsonVersion(packageLockPath)
const serverPackageJsonChanged = await syncJsonVersion(serverPackageJsonPath)

if (!packageJsonChanged && !packageLockChanged && !serverPackageJsonChanged) {
  console.log(`Package metadata already uses version ${rawVersion}`)
  process.exit(0)
}

console.log(`Updated package metadata to version ${rawVersion}`)
