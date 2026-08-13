import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'
import { getNextVersion, getReleaseType, incrementVersion } from './release-utils.mjs'

const execFileAsync = promisify(execFile)

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

  assert.match(
    workflow,
    /uses:\s+apple-actions\/import-codesign-certs@63fff01cd422d4b7b855d40ca1e9d34d2de9427d\s+# v3/,
  )
  assert.doesNotMatch(workflow, /uses:\s+apple-actions\/import-codesign-certs@v3(?:\s|$)/)
  assert.match(workflow, /MACOS_CERTIFICATE_P12/)
  assert.match(workflow, /MACOS_CERTIFICATE_PASSWORD/)
  assert.match(workflow, /APPLE_ID:\s+\$\{\{\s+matrix\.os\s*==\s*'macos-latest'\s*&&\s+vars\.APPLE_ID\s*\|\|\s*''\s+\}\}/)
  assert.match(workflow, /APPLE_APP_SPECIFIC_PASSWORD/)
  assert.match(workflow, /APPLE_TEAM_ID:\s+\$\{\{\s+matrix\.os\s*==\s*'macos-latest'\s*&&\s+vars\.APPLE_TEAM_ID\s*\|\|\s*''\s+\}\}/)
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY:\s+\$\{\{\s+matrix\.os\s*==\s*'macos-latest'\s*&&\s*'true'\s*\|\|\s*'false'\s+\}\}/)
  assert.match(workflow, /Refusing to publish an unsigned or unnotarized macOS release/)
  assert.match(workflow, /exit 1/)
  assert.doesNotMatch(workflow, /has_certs/)
  assert.match(workflow, /name:\s+Import Apple signing certificate\n\s+if:\s+matrix\.os == 'macos-latest'/)
})

test('syncs package metadata to the release tag before packaging', () => {
  const workflow = readFileSync(resolve('.github/workflows/trigger-release.yml'), 'utf8')

  assert.match(workflow, /name:\s+Sync package version to release tag/)
  assert.match(workflow, /TARGET_VERSION="\$\{TAG#v\}"/)
  assert.match(workflow, /node scripts\/sync-package-version\.mjs "\$TARGET_VERSION"/)
  assert.doesNotMatch(workflow, /pkg\.version = process\.argv\[1\]/)
})

test('version sync keeps root and standalone server package metadata valid and aligned', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'terminay-version-sync-'))
  try {
    await mkdir(join(fixture, 'apps/terminay-server'), { recursive: true })
    await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'terminay', version: '0.0.0' }))
    await writeFile(join(fixture, 'apps/terminay-server/package.json'), JSON.stringify({ name: '@terminay/server', version: '0.0.0' }))
    await writeFile(join(fixture, 'package-lock.json'), JSON.stringify({
      name: 'terminay',
      version: '0.0.0',
      packages: {
        '': { name: 'terminay', version: '0.0.0' },
        'apps/terminay-server': { name: '@terminay/server', version: '0.0.0' },
      },
    }))

    await execFileAsync(process.execPath, [resolve('scripts/sync-package-version.mjs'), '2.0.0'], { cwd: fixture })
    assert.equal(JSON.parse(await readFile(join(fixture, 'package.json'), 'utf8')).version, '2.0.0')
    assert.equal(JSON.parse(await readFile(join(fixture, 'apps/terminay-server/package.json'), 'utf8')).version, '2.0.0')
    const lock = JSON.parse(await readFile(join(fixture, 'package-lock.json'), 'utf8'))
    assert.equal(lock.version, '2.0.0')
    assert.equal(lock.packages[''].version, '2.0.0')
    assert.equal(lock.packages['apps/terminay-server'].version, '2.0.0')
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

test('release notes prompt requires the exact release diff range', () => {
  const prompt = readFileSync(resolve('.github/prompts/github-create-release.md'), 'utf8')

  assert.match(prompt, /previous-tag-to-target-tag git range/)
  assert.match(prompt, /Do not summarize commits, pull requests, release bodies, or project files from outside the provided range/)
  assert.match(prompt, /Only claim a feature was introduced when the provided commits or diff show that introduction happened in this range/)
})

test('AI release notes generator passes bounded git context to the model', () => {
  const script = readFileSync(resolve('scripts/generate-release-notes.mjs'), 'utf8')

  assert.match(script, /getPreviousTag/)
  assert.match(script, /Git range:/)
  assert.match(script, /Commits in range:/)
  assert.match(script, /Changed files in range:/)
  assert.match(script, /Do not include features, fixes, or dependency updates from earlier releases/)
	assert.match(script, /requestReleaseNotes/)
	assert.doesNotMatch(script, /opencode-ai/)
})

test('optional AI release notes fall back without blocking release artifacts', () => {
  const workflow = readFileSync(resolve('.github/workflows/trigger-release.yml'), 'utf8')

  assert.match(workflow, /name:\s+Generate AI release notes\n\s+id:\s+generate_release_notes/)
  assert.match(workflow, /continue-on-error:\s+true/)
  assert.match(workflow, /name:\s+Use fallback release notes/)
  assert.match(workflow, /steps\.generate_release_notes\.outcome != 'success'/)
  assert.match(workflow, /generate-fallback-release-notes\.mjs/)
  assert.doesNotMatch(workflow, /without AI-assisted release notes/)
})

test('release publication creates the tag through the step-scoped GitHub API token', () => {
  const script = readFileSync(resolve('scripts/create-release.mjs'), 'utf8')

  assert.match(script, /process\.env\.GITHUB_TOKEN \?\? process\.env\.GH_TOKEN/)
  assert.match(script, /target_commitish: targetCommitish/)
  assert.match(script, /const targetCommitish = await run\('git', \['rev-parse', 'HEAD'\]\)/)
  assert.match(script, /const publishedWithGitHubToken = await createGitHubRelease\(tag, targetCommitish\)/)
  assert.match(script, /if \(!publishedWithGitHubToken\) \{\s+await run\('git', \['push', 'origin', tag\]\)\s+\}/)
})
