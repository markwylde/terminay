#!/usr/bin/env node
// Verifies an electron-updater metadata file (latest-mac.yml, beta-linux.yml,
// ...) against the payload bytes it points at, before that file is allowed to
// become visible to installed clients.
//
// The file is written by electron-builder's serializer, so only that shape is
// accepted: top-level `key: value` pairs, a `files:` sequence of flat
// mappings, and block or quoted scalars for keys this check does not read.
// Anything else fails closed. No YAML dependency is needed, which lets the
// publishing jobs run this without installing the workspace.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_METADATA_BYTES = 1024 * 1024
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u
const SHA512_BASE64 = /^[A-Za-z0-9+/]{86}==$/u
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u
const TOP_LEVEL_KEY = /^([A-Za-z][A-Za-z0-9]*):(?: (.*))?$/u
const ENTRY_START = /^ {2}- ([A-Za-z][A-Za-z0-9]*): (.+)$/u
const ENTRY_FIELD = /^ {4}([A-Za-z][A-Za-z0-9]*): (.+)$/u

export class UpdateMetadataError extends Error {}

function fail(message) {
  throw new UpdateMetadataError(message)
}

function parseScalar(raw, label) {
  const value = raw.trim()
  if (value.length === 0) fail(`${label} is empty`)
  if (value.startsWith("'")) {
    if (value.length < 2 || !value.endsWith("'")) fail(`${label} has an unterminated quote`)
    const inner = value.slice(1, -1)
    if (inner.replaceAll("''", '').includes("'")) fail(`${label} is not a valid quoted scalar`)
    return inner.replaceAll("''", "'")
  }
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value)
      if (typeof parsed !== 'string') fail(`${label} is not a string`)
      return parsed
    } catch (error) {
      if (error instanceof UpdateMetadataError) throw error
      fail(`${label} is not a valid quoted scalar`)
    }
  }
  if (/^[[\]{}&*!|>%@`#,?:-]/u.test(value) || / #/u.test(value)) {
    fail(`${label} is not a plain scalar`)
  }
  return value
}

/**
 * Parses the electron-builder update-info subset. Keys the verifier reads are
 * returned as strings; every other top-level key is recorded as present with
 * its raw text so callers can require it without interpreting it.
 */
export function parseUpdateMetadata(text) {
  if (typeof text !== 'string') fail('metadata must be text')
  if (text.includes('\r')) fail('metadata must use LF line endings')
  const lines = text.split('\n')
  const result = { files: null, other: new Map() }
  const seen = new Set()
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (line.trim() === '') {
      index += 1
      continue
    }
    const match = TOP_LEVEL_KEY.exec(line)
    if (!match) fail(`unexpected metadata line ${index + 1}`)
    const [, key, rawValue] = match
    if (seen.has(key)) fail(`duplicate metadata key: ${key}`)
    seen.add(key)
    index += 1

    if (key === 'files') {
      if (rawValue !== undefined && rawValue.trim() !== '') fail('files must be a block sequence')
      const files = []
      let current = null
      while (index < lines.length && lines[index].startsWith(' ')) {
        const entryLine = lines[index]
        const start = ENTRY_START.exec(entryLine)
        const field = start ? null : ENTRY_FIELD.exec(entryLine)
        if (start) {
          current = new Map()
          files.push(current)
        } else if (!field || current === null) {
          fail(`unexpected files line ${index + 1}`)
        }
        const [, fieldName, fieldValue] = start ?? field
        if (current.has(fieldName)) fail(`duplicate files field: ${fieldName}`)
        current.set(fieldName, parseScalar(fieldValue, `files.${fieldName}`))
        index += 1
      }
      result.files = files.map((entry) => Object.fromEntries(entry))
      continue
    }

    const continuation = []
    while (index < lines.length && (lines[index].startsWith(' ') || lines[index] === '')) {
      continuation.push(lines[index])
      index += 1
    }
    // Trailing blank lines belong to the document, not to this key.
    while (continuation.length > 0 && continuation.at(-1) === '') continuation.pop()

    if (key === 'version' || key === 'path' || key === 'sha512') {
      if (rawValue === undefined || continuation.length > 0) fail(`${key} must be a single-line scalar`)
      result[key] = parseScalar(rawValue, key)
    } else {
      result.other.set(key, [rawValue ?? '', ...continuation].join('\n'))
    }
  }

  return result
}

async function sha512OfFile(path) {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('base64')
}

/**
 * Checks one metadata file against the payload directory and, when given, the
 * exact set of files it must reference and the names attached to the release.
 * Resolves to the metadata version.
 */
export async function verifyUpdateMetadata({
  metadataPath,
  assetsDir,
  version,
  expectedFiles,
  releaseAssetNames,
  requireReleaseNotes = false,
}) {
  const info = await lstat(metadataPath)
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_METADATA_BYTES) {
    fail('metadata must be a bounded regular file')
  }
  const metadata = parseUpdateMetadata(await readFile(metadataPath, 'utf8'))

  if (typeof metadata.version !== 'string' || !VERSION.test(metadata.version)) {
    fail('metadata version is missing or invalid')
  }
  if (version !== undefined && metadata.version !== version) {
    fail(`metadata version ${metadata.version} is not ${version}`)
  }
  if (!Array.isArray(metadata.files) || metadata.files.length === 0) {
    fail('metadata must reference at least one file')
  }
  if (requireReleaseNotes && !(metadata.other.get('releaseNotes') ?? '').trim()) {
    fail('metadata must carry release notes')
  }

  const urls = new Set()
  for (const file of metadata.files) {
    if (typeof file.url !== 'string' || !ASSET_NAME.test(file.url)) {
      fail('every referenced file must be a plain release asset name')
    }
    if (urls.has(file.url)) fail(`file is referenced twice: ${file.url}`)
    urls.add(file.url)
    if (typeof file.sha512 !== 'string' || !SHA512_BASE64.test(file.sha512)) {
      fail(`${file.url} has no valid sha512`)
    }
    if (typeof file.size !== 'string' || !/^[1-9]\d*$/u.test(file.size)) {
      fail(`${file.url} has no valid size`)
    }
  }

  // The legacy top-level fields must describe the first file, never a
  // different one that the per-file checks below would not cover.
  if (metadata.path !== undefined && metadata.path !== metadata.files[0].url) {
    fail('metadata path does not name the first referenced file')
  }
  if (metadata.sha512 !== undefined && metadata.sha512 !== metadata.files[0].sha512) {
    fail('metadata sha512 does not match the first referenced file')
  }

  if (expectedFiles !== undefined) {
    const expected = [...new Set(expectedFiles)].sort()
    const actual = [...urls].sort()
    if (expected.length !== actual.length || expected.some((name, i) => name !== actual[i])) {
      fail(`metadata references ${actual.join(', ')}; expected ${expected.join(', ')}`)
    }
  }

  if (releaseAssetNames !== undefined) {
    const attached = new Set(releaseAssetNames)
    for (const url of urls) {
      if (!attached.has(url)) fail(`${url} is not an asset of the release`)
    }
  }

  for (const file of metadata.files) {
    const payloadPath = join(assetsDir, file.url)
    const payload = await lstat(payloadPath).catch(() => null)
    if (payload === null || !payload.isFile() || payload.isSymbolicLink()) {
      fail(`${file.url} must be a regular file beside the metadata`)
    }
    if (String(payload.size) !== file.size) fail(`${file.url} size does not match the metadata`)
    if ((await sha512OfFile(payloadPath)) !== file.sha512) {
      fail(`${file.url} sha512 does not match the metadata`)
    }
  }

  return metadata.version
}

function parseArguments(argv) {
  const options = { expectedFiles: [], requireReleaseNotes: false }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--require-release-notes') {
      options.requireReleaseNotes = true
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) fail(`${flag} needs a value`)
    index += 1
    if (flag === '--metadata') options.metadataPath = value
    else if (flag === '--assets-dir') options.assetsDir = value
    else if (flag === '--version') options.version = value
    else if (flag === '--expect-file') options.expectedFiles.push(value)
    else if (flag === '--release-assets') options.releaseAssetsPath = value
    else fail(`unknown argument: ${flag}`)
  }
  if (!options.metadataPath || !options.assetsDir || options.expectedFiles.length === 0) {
    fail(
      'usage: verify-update-metadata.mjs --metadata <yml> --assets-dir <dir> --expect-file <name>... ' +
        '[--version <version>] [--release-assets <names file>] [--require-release-notes]',
    )
  }
  return options
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const options = parseArguments(process.argv.slice(2))
    const releaseAssetNames = options.releaseAssetsPath
      ? (await readFile(options.releaseAssetsPath, 'utf8')).split('\n').filter(Boolean)
      : undefined
    const version = await verifyUpdateMetadata({ ...options, releaseAssetNames })
    process.stdout.write(`${version}\n`)
  } catch (error) {
    console.error(`update metadata verification failed: ${error.message}`)
    process.exit(1)
  }
}
