#!/usr/bin/env node
// Names and describes a Nightly or Canary build of `main` (ADR-0109).
//
// The version is the next stable version the release workflow would cut from
// these commits, then `main`, the number of commits reachable from the built
// commit, and the track: `<next>-main.<count>.<track>`. Semantic-version
// precedence compares those identifiers left to right, so `main` always ties,
// a later commit sorts higher on either track, and only for one commit does
// the track name decide (`nightly` above `canary`). The next stable release
// sorts above every prerelease that led to it, and every old `-beta.N` build
// sorts below these on the same base version (`beta` < `main`).
//
// The count only grows while `main` only moves forward. A history rewrite
// would make it shrink and every build after it sort below what is already
// installed, so the count is checked against the track's published build.
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { getNextVersion, incrementVersion } from './release-utils.mjs'

const execFileAsync = promisify(execFile)
const CANONICAL_TAG = /^v\d+\.\d+\.\d+$/u
export const TRACKS = Object.freeze(['nightly', 'canary'])
export const PRERELEASE_VERSION = /^(\d+\.\d+\.\d+)-main\.([1-9]\d*)\.(nightly|canary)$/u
export const MAX_NOTES_ENTRIES = 200
export const MAX_NOTES_BYTES = 16 * 1024

export function getPrereleaseVersion({ latestTag, messages, commitCount, track }) {
  if (!TRACKS.includes(track)) throw new Error(`Invalid track: ${track}`)
  const count = String(commitCount)
  if (!/^[1-9]\d*$/u.test(count)) throw new Error(`Invalid commit count: ${commitCount}`)
  if (latestTag !== null && !CANONICAL_TAG.test(latestTag)) {
    throw new Error(`Invalid release tag: ${latestTag}`)
  }
  // With no commit since the last tag, `main` is that release; the prerelease
  // still has to name something newer than it, so it takes the next patch.
  const next =
    getNextVersion({ latestTag, messages }) ??
    incrementVersion(latestTag === null ? '0.0.0' : latestTag.slice(1), 'patch')
  return `${next}-main.${count}.${track}`
}

/**
 * The commit count recorded by a track's published `build.json`, or null when
 * there is none to compare with (the first build of a track, or a file that
 * names no version of this form).
 */
export function publishedCommitCount(buildJson) {
  if (typeof buildJson !== 'object' || buildJson === null) return null
  const match = PRERELEASE_VERSION.exec(String(buildJson.version ?? ''))
  return match ? Number(match[2]) : null
}

/**
 * Refuses a build whose commit count is below the one its track already
 * published: that build would sort below installed ones and never be offered.
 */
export function assertCountNotBehind({ commitCount, buildJson }) {
  const published = publishedCommitCount(buildJson)
  if (published !== null && Number(commitCount) < published) {
    throw new Error(
      `This build's commit count ${commitCount} is below the published build's ${published} (${buildJson.version}); ` +
        'has main been rewritten?',
    )
  }
}

/**
 * One Markdown bullet per commit subject, newest first, bounded so a long
 * stretch without a release cannot produce an unbounded update-metadata file.
 */
export function formatPrereleaseNotes({ latestTag, subjects }) {
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

async function readBuildJson(path) {
  if (path === undefined) return null
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    // The first build of a track has nothing published to compare with.
    if (error?.code === 'ENOENT') return null
    throw error
  }
  return JSON.parse(text)
}

function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 2) {
    const [flag, value] = [argv[index], argv[index + 1]]
    if (value === undefined) return null
    if (flag === '--track') options.track = value
    else if (flag === '--notes-out') options.notesOut = value
    else if (flag === '--published-build') options.publishedBuild = value
    else return null
  }
  return options.track && options.notesOut ? options : null
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const options = parseArguments(process.argv.slice(2))
  if (options === null) {
    console.error('usage: prerelease-version.mjs --track <nightly|canary> --notes-out <file> [--published-build <build.json>]')
    process.exit(1)
  }
  try {
    const latestTag = await getLatestTag()
    const commitCount = (await git(['rev-list', '--count', 'HEAD'])).trim()
    assertCountNotBehind({ commitCount, buildJson: await readBuildJson(options.publishedBuild) })
    const version = getPrereleaseVersion({
      latestTag,
      messages: await getCommits(latestTag, '%B'),
      commitCount,
      track: options.track,
    })
    const notes = formatPrereleaseNotes({ latestTag, subjects: await getCommits(latestTag, '%s') })
    await writeFile(options.notesOut, notes, { flag: 'wx' })
    process.stdout.write(`${version}\n`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
