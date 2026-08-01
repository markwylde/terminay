#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildSecureWeriftCandidate,
  packSecureWeriftCandidate,
  prepareSecureWeriftSourceMirror,
  WERIFT_CANDIDATE_VERSION,
} from './build-secure-werift-candidate.mjs'

export async function proveSecureWeriftOfflineRebuild(mirrorRoot) {
  const temporary = await mkdtemp(`${tmpdir()}/terminay-werift-offline-proof-`)
  try {
    const first = await buildSecureWeriftCandidate(`${temporary}/first`, {
      sourceMirror: resolve(mirrorRoot),
    })
    const second = await buildSecureWeriftCandidate(`${temporary}/second`, {
      sourceMirror: resolve(mirrorRoot),
    })
    assert.deepEqual(first.fileHashes, second.fileHashes, 'Offline candidate rebuilds differ.')
    const [firstArchive, secondArchive] = await Promise.all([
      packSecureWeriftCandidate(first.artifactRoot),
      packSecureWeriftCandidate(second.artifactRoot),
    ])
    assert.deepEqual(firstArchive.bytes, secondArchive.bytes, 'Offline candidate archives differ.')
    return {
      archiveSha256: createHash('sha256').update(firstArchive.bytes).digest('hex'),
      candidateVersion: WERIFT_CANDIDATE_VERSION,
      networkPolicy: 'npm-offline; mirrored-license; no-fetch',
    }
  } finally {
    await rm(temporary, { force: true, recursive: true })
  }
}

async function main(argv) {
  if (argv.length !== 2 || !['--prepare-mirror', '--prove-mirror'].includes(argv[0])) {
    throw new Error('usage: prove-secure-werift-offline-rebuild.mjs (--prepare-mirror|--prove-mirror) PATH')
  }
  const result = argv[0] === '--prepare-mirror'
    ? await prepareSecureWeriftSourceMirror(resolve(argv[1]))
    : await proveSecureWeriftOfflineRebuild(resolve(argv[1]))
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2))
}
