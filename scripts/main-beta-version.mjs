#!/usr/bin/env node
// Names and describes a desktop build of `main` for the rolling beta channel.
//
// The version is the next stable version the release workflow would cut from
// these commits, with the workflow run number as a beta component:
// `<next>-beta.<run>`. Run numbers only grow, so every build sorts above the
// previous one, and the next stable release sorts above all of its betas.
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { getNextVersion, incrementVersion } from './release-utils.mjs'

const execFileAsync = promisify(execFile)
const CANONICAL_TAG = /^v\d+\.\d+\.\d+$/u
export const MAX_NOTES_ENTRIES = 200
export const MAX_NOTES_BYTES = 16 * 1024

export function getBetaVersion({ latestTag, messages, runNumber }) {
  const run = String(runNumber)
  if (!/^[1-9]\d*$/u.test(run)) throw new Error(`Invalid workflow run number: ${runNumber}`)
  if (latestTag !== null && !CANONICAL_TAG.test(latestTag)) {
    throw new Error(`Invalid release tag: ${latestTag}`)
  }
  // With no commit since the last tag, `main` is that release; the beta still
  // has to name something newer than it, so it takes the next patch.
  const next =
    getNextVersion({ latestTag, messages }) ??
    incrementVersion(latestTag === null ? '0.0.0' : latestTag.slice(1), 'patch')
  return `${next}-beta.${run}`
}

/**
 * One Markdown bullet per commit subject, newest first, bounded so a long
 * stretch without a release cannot produce an unbounded update-metadata file.
 */
export function formatBetaReleaseNotes({ latestTag, subjects }) {
  if (subjects.length === 0) {
    return latestTag === null ? '- No changes.\n' : `- No changes since ${latestTag}.\n`
  }
  const lines = []
  let bytes = 0
  for (const subject of subjects) {
    const line = `- ${subject.replace(/\s+/gu, ' ').trim()}\n`
    const size = Buffer.byteLength(line)
    if (lines.length === MAX_NOTES_ENTRIES || bytes + size > MAX_NOTES_BYTES) break
    lines.push(line)
    bytes += size
  }
  const omitted = subjects.length - lines.length
  if (omitted > 0) lines.push(`- …and ${omitted} more ${omitted === 1 ? 'commit' : 'commits'}.\n`)
  return lines.join('')
}

async function git(args) {
  const { stdout } = await execFileAsync('git', args, { maxBuffer: 64 * 1024 * 1024 })
  return stdout
}

async function getLatestTag() {
  const tags = (await git(['tag', '--list', 'v*', '--sort=-version:refname'])).split('\n')
  return tags.map((tag) => tag.trim()).find((tag) => CANONICAL_TAG.test(tag)) ?? null
}

async function getCommits(latestTag, format) {
  const range = latestTag === null ? ['HEAD'] : [`${latestTag}..HEAD`]
  return (await git(['log', ...range, `--format=${format}%x1e`]))
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [flag, runNumber, notesFlag, notesPath] = process.argv.slice(2)
  if (flag !== '--run-number' || notesFlag !== '--notes-out' || !notesPath || process.argv.length !== 6) {
    console.error('usage: main-beta-version.mjs --run-number <n> --notes-out <file>')
    process.exit(1)
  }
  const latestTag = await getLatestTag()
  const version = getBetaVersion({ latestTag, messages: await getCommits(latestTag, '%B'), runNumber })
  const notes = formatBetaReleaseNotes({ latestTag, subjects: await getCommits(latestTag, '%s') })
  await writeFile(notesPath, notes, { flag: 'wx' })
  process.stdout.write(`${version}\n`)
}
