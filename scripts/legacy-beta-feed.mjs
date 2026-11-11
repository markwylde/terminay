#!/usr/bin/env node
// Whether the Nightly is still also published for installed Beta builds
// (three-release-tracks, design decision 7).
//
// Beta was replaced by Nightly. For 90 days from the change landing, each
// Nightly publication also writes `beta-mac.yml`, `beta-linux.yml` and
// `beta.yml` beside its own metadata on `main-latest`, and its image is also
// tagged `beta`, so an installed Beta build sees the Nightly, installs it, and
// becomes Nightly on first launch. The rolling release workflow and the image
// workflow both ask this one script, so they stop on the same day.
//
// After that date neither is published. The follow-up change
// `retire-beta-feed` deletes this script, the copies, the tag, and the
// settings mapping of `beta` to `nightly`.
//
//   legacy-beta-feed.mjs [--now <ISO date>]
//
// Prints `true` while the legacy feed is published, `false` after.
import { pathToFileURL } from 'node:url'

/** The last day, in UTC, on which the legacy Beta feed is published. */
export const LEGACY_BETA_FEED_UNTIL = '2027-02-09'

const DAY_MS = 24 * 60 * 60 * 1000

export function legacyBetaFeedActive(now = new Date(), until = LEGACY_BETA_FEED_UNTIL) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(until)) throw new Error(`Not a date: ${until}`)
  const time = now instanceof Date ? now.getTime() : Number.NaN
  if (Number.isNaN(time)) throw new Error('Not a valid current time')
  // The whole of the last day is included.
  return time < Date.parse(`${until}T00:00:00Z`) + DAY_MS
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2)
  if (!(args.length === 0 || (args.length === 2 && args[0] === '--now'))) {
    console.error('usage: legacy-beta-feed.mjs [--now <ISO date>]')
    process.exit(1)
  }
  try {
    const now = args.length === 2 ? new Date(args[1]) : new Date()
    process.stdout.write(`${legacyBetaFeedActive(now)}\n`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
