import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export function parseSingleNpmPackResult(value) {
  const metadata = typeof value === 'string' ? JSON.parse(value) : value
  const candidates = Array.isArray(metadata)
    ? metadata
    : metadata && typeof metadata === 'object'
      ? 'filename' in metadata ? [metadata] : Object.values(metadata)
      : []
  const result = candidates.length === 1 ? candidates[0] : null
  assert.ok(result && typeof result === 'object' && !Array.isArray(result), 'npm pack returned unsupported metadata')
  return result
}

export function parseSingleNpmJsonValue(value) {
  const metadata = typeof value === 'string' ? JSON.parse(value) : value
  assert.ok(Array.isArray(metadata) ? metadata.length === 1 : metadata != null, 'npm returned unsupported JSON metadata')
  return Array.isArray(metadata) ? metadata[0] : metadata
}

export async function readSingleNpmPackResult(path) {
  return parseSingleNpmPackResult(await readFile(path, 'utf8'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await readSingleNpmPackResult(process.argv[2])
  assert.equal(typeof result.filename, 'string', 'npm pack result omitted filename')
  process.stdout.write(result.filename)
}
