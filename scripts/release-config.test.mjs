import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { getNextVersion, getReleaseType, incrementVersion } from './release-utils.mjs'

test('returns no release when there are zero commits', () => {
  assert.equal(getReleaseType([]), null)
})

test('treats chore commits as patch releases', () => {
  assert.equal(getReleaseType(['chore: refresh packaging metadata']), 'patch')
})

test('treats ignored non-conventional commit subjects as patch releases', () => {
  assert.equal(getReleaseType(['Polish terminal workspace layout']), 'patch')
})

test('keeps feature commits as minor releases', () => {
  assert.equal(getReleaseType(['feat: add popout terminal groups']), 'minor')
})

test('keeps breaking changes as major releases', () => {
  assert.equal(
    getReleaseType([
      'feat!: change session API\n\nBREAKING CHANGE: preload terminal session contracts now require explicit options',
    ]),
    'major',
  )
})

test('bumps versions from an existing tag', () => {
  assert.equal(incrementVersion('1.2.3', 'patch'), '1.2.4')
  assert.equal(incrementVersion('1.2.3', 'minor'), '1.3.0')
  assert.equal(incrementVersion('1.2.3', 'major'), '2.0.0')
})

test('derives the first release from a 0.0.0 baseline when no tag exists', () => {
  assert.equal(
    getNextVersion({
      latestTag: null,
      messages: ['feat: initial release'],
    }),
    '0.1.0',
  )
})

test('derives a patch first release from a 0.0.0 baseline', () => {
  assert.equal(
    getNextVersion({
      latestTag: null,
      messages: ['chore: initial release plumbing'],
    }),
    '0.0.1',
  )
})

test('wires Apple signing secrets into the release workflow', () => {
  const workflow = readFileSync(resolve('.github/workflows/trigger-release.yml'), 'utf8')

  assert.match(workflow, /uses:\s+apple-actions\/import-codesign-certs@v3/)
  assert.match(workflow, /MACOS_CERTIFICATE_P12/)
  assert.match(workflow, /MACOS_CERTIFICATE_PASSWORD/)
  assert.match(workflow, /APPLE_ID:\s+\$\{\{\s+matrix\.os\s*==\s*'macos-latest'\s*&&\s+vars\.APPLE_ID\s*\|\|\s*''\s+\}\}/)
  assert.match(workflow, /APPLE_APP_SPECIFIC_PASSWORD/)
  assert.match(workflow, /APPLE_TEAM_ID:\s+\$\{\{\s+matrix\.os\s*==\s*'macos-latest'\s*&&\s+vars\.APPLE_TEAM_ID\s*\|\|\s*''\s+\}\}/)
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY:\s+\$\{\{\s+matrix\.os\s*==\s*'macos-latest'\s*&&\s*'true'\s*\|\|\s*'false'\s+\}\}/)
})

test('syncs package metadata to the release tag before packaging', () => {
  const workflow = readFileSync(resolve('.github/workflows/trigger-release.yml'), 'utf8')

  assert.match(workflow, /name:\s+Sync package version to release tag/)
  assert.match(workflow, /TARGET_VERSION="\$\{TAG#v\}"/)
  assert.match(workflow, /node scripts\/sync-package-version\.mjs "\$TARGET_VERSION"/)
})
