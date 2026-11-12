#!/usr/bin/env node
// Decides whether tonight's Nightly builds anything (ADR-0110).
//
// The nightly rolling release carries `build.json`, `{ "commit", "version" }`,
// moved into place after everything else in a publication. When it names the
// commit at the head of `main`, that commit is already the published Nightly
// and the run builds nothing: no archives, no image, and no submission to
// Apple. A nightly that failed before publication never moved `build.json`, so
// the next run still sees the older commit and builds. A missing or unreadable
// file cannot prove anything was published, so it builds too.
//
//   nightly-skip.mjs --head <commit> --build-json <path>
//
// Prints `build=true` or `build=false`, ready for $GITHUB_OUTPUT.
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const COMMIT = /^[0-9a-f]{40}$/u

export function shouldBuildNightly({ headCommit, buildJson }) {
  if (!COMMIT.test(String(headCommit))) throw new Error(`Not a full commit: ${headCommit}`)
  if (typeof buildJson !== 'object' || buildJson === null) return true
  if (!COMMIT.test(String(buildJson.commit))) return true
  return buildJson.commit !== headCommit
}

async function readBuildJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [headFlag, headCommit, fileFlag, path] = process.argv.slice(2)
  if (headFlag !== '--head' || fileFlag !== '--build-json' || !path || process.argv.length !== 6) {
    console.error('usage: nightly-skip.mjs --head <commit> --build-json <path>')
    process.exit(1)
  }
  try {
    const build = shouldBuildNightly({ headCommit, buildJson: await readBuildJson(path) })
    process.stdout.write(`build=${build}\n`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
