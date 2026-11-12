#!/usr/bin/env node
// The version the Windows update probe's build N+1 carries: the smallest
// change that still sorts above build N on its own track.
//
// A stable build `X.Y.Z` becomes `X.Y.(Z+1)-update-probe`. A Nightly or Canary
// `X.Y.Z-main.<count>.<track>` (ADR-0110) becomes the same track one commit
// later, `X.Y.Z-main.<count + 1>.<track>`, which is what the next build of
// that track would be called.
//
//   update-probe-version.mjs <version of build N>
import { pathToFileURL } from 'node:url'

export function nextUpdateProbeVersion(version) {
  const stable = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version)
  if (stable) return `${stable[1]}.${stable[2]}.${Number(stable[3]) + 1}-update-probe`
  const prerelease = /^(\d+\.\d+\.\d+)-main\.([1-9]\d*)\.(nightly|canary)$/u.exec(version)
  if (prerelease) return `${prerelease[1]}-main.${Number(prerelease[2]) + 1}.${prerelease[3]}`
  throw new Error(`Not a stable, nightly or canary version: ${version}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv.length !== 3) {
    console.error('usage: update-probe-version.mjs <version>')
    process.exit(64)
  }
  try {
    process.stdout.write(`${nextUpdateProbeVersion(process.argv[2])}\n`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(65)
  }
}
