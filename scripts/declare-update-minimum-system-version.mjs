#!/usr/bin/env node
// Declares the oldest operating system an update supports in its
// electron-updater metadata, so an installed client on an older system keeps
// its current version instead of installing one it cannot launch.
//
// electron-updater compares this value with `os.release()`, which on macOS is
// the Darwin kernel version, not the marketing version: macOS 13 is Darwin 22.
// electron-builder writes the minimum into Info.plist but not into the update
// metadata, so the publishing jobs add it here before verification.
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parseUpdateMetadata, UpdateMetadataError } from './verify-update-metadata.mjs'

const SEMVER = /^\d+\.\d+\.\d+$/u

export function declareMinimumSystemVersion(text, minimumSystemVersion) {
  if (!SEMVER.test(minimumSystemVersion)) {
    throw new UpdateMetadataError('minimum system version must be an exact x.y.z version')
  }
  const metadata = parseUpdateMetadata(text)
  if (metadata.other.has('minimumSystemVersion')) {
    throw new UpdateMetadataError('metadata already declares a minimum system version')
  }
  const body = text.endsWith('\n') ? text : `${text}\n`
  return `${body}minimumSystemVersion: ${minimumSystemVersion}\n`
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [metadataPath, minimumSystemVersion] = process.argv.slice(2)
  try {
    if (!metadataPath || !minimumSystemVersion) {
      throw new UpdateMetadataError(
        'usage: declare-update-minimum-system-version.mjs <metadata yml> <x.y.z>',
      )
    }
    const text = await readFile(metadataPath, 'utf8')
    await writeFile(metadataPath, declareMinimumSystemVersion(text, minimumSystemVersion))
  } catch (error) {
    console.error(`declaring the minimum system version failed: ${error.message}`)
    process.exit(1)
  }
}
