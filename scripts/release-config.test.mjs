import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'
import { EMBEDDED_KEY_SOURCE, assertEmbeddedKeyMatches } from './check-embedded-release-key.mjs'
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
    /uses:\s+apple-actions\/import-codesign-certs@2dbeb2d7c37642111f938c56ef0feb5d51dad55d\s+# v4\.0\.1/,
  )
  assert.doesNotMatch(workflow, /uses:\s+apple-actions\/import-codesign-certs@v4(?:\s|$)/)
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

test('version sync keeps root, standalone server, and CLI package metadata valid and aligned', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'terminay-version-sync-'))
  try {
    await mkdir(join(fixture, 'apps/terminay-server'), { recursive: true })
    await mkdir(join(fixture, 'apps/terminay-cli'), { recursive: true })
    await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'terminay', version: '0.0.0' }))
    await writeFile(join(fixture, 'apps/terminay-server/package.json'), JSON.stringify({ name: '@terminay/server', version: '0.0.0' }))
    await writeFile(join(fixture, 'apps/terminay-cli/package.json'), JSON.stringify({ name: 'terminay', version: '0.0.0' }))
    await writeFile(join(fixture, 'package-lock.json'), JSON.stringify({
      name: 'terminay',
      version: '0.0.0',
      packages: {
        '': { name: 'terminay', version: '0.0.0' },
        'apps/terminay-server': { name: '@terminay/server', version: '0.0.0' },
        'apps/terminay-cli': { name: 'terminay', version: '0.0.0' },
      },
    }))

    await execFileAsync(process.execPath, [resolve('scripts/sync-package-version.mjs'), '2.0.0'], { cwd: fixture })
    assert.equal(JSON.parse(await readFile(join(fixture, 'package.json'), 'utf8')).version, '2.0.0')
    assert.equal(JSON.parse(await readFile(join(fixture, 'apps/terminay-server/package.json'), 'utf8')).version, '2.0.0')
    // The published CLI must carry the release version too: it is what
    // `npx terminay@X.Y.Z` resolves.
    assert.equal(JSON.parse(await readFile(join(fixture, 'apps/terminay-cli/package.json'), 'utf8')).version, '2.0.0')
    const lock = JSON.parse(await readFile(join(fixture, 'package-lock.json'), 'utf8'))
    assert.equal(lock.version, '2.0.0')
    assert.equal(lock.packages[''].version, '2.0.0')
    assert.equal(lock.packages['apps/terminay-server'].version, '2.0.0')
    assert.equal(lock.packages['apps/terminay-cli'].version, '2.0.0')
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

test('the CLI embeds the release signing key and the check catches a mismatch', async () => {
  const source = await readFile(resolve(EMBEDDED_KEY_SOURCE), 'utf8')

  // The key the repository ships is the key the release variable names.
  const signing =
    'LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUNvd0JRWURLMlZ3QXlFQVlDNTJsd09xRmVmTFhDcHY5R2NwbGZNajgvK1FEakExUmg5NXZFWmxMY2c9Ci0tLS0tRU5EIFBVQkxJQyBLRVktLS0tLQo='
  assert.ok(assertEmbeddedKeyMatches(source, signing))

  // A rotated signing key the CLI has not been updated for must fail the
  // release rather than ship a CLI that refuses its own archives.
  const { publicKey } = generateKeyPairSync('ed25519')
  const rotated = Buffer.from(publicKey.export({ type: 'spki', format: 'pem' })).toString('base64')
  assert.throws(() => assertEmbeddedKeyMatches(source, rotated), /is not the release signing key/)

  assert.throws(() => assertEmbeddedKeyMatches(source, ''), /is required/)
  assert.throws(() => assertEmbeddedKeyMatches(source, 'not base64!'), /base64-encoded PEM/)
  assert.throws(() => assertEmbeddedKeyMatches('no key here', signing), /no public key is embedded/)
})

test('the release workflow publishes the CLI only after the key check passes', () => {
  const workflow = readFileSync(resolve('.github/workflows/trigger-release.yml'), 'utf8')

  const jobStart = workflow.indexOf('  publish-cli:\n')
  assert.ok(jobStart >= 0, 'expected a publish-cli job')
  const job = workflow.slice(jobStart)
  const keyCheck = job.indexOf('scripts/check-embedded-release-key.mjs')
  const publish = job.indexOf('npm publish')
  assert.ok(keyCheck >= 0, 'expected the embedded key check')
  assert.ok(publish > keyCheck, 'the key check must run before npm publish')
  // Publishing after the archives are attached is what makes
  // `npx terminay@X.Y.Z daemon install` able to resolve its own release.
  assert.match(job, /needs: \[release, build-standalone-server\]/)
  assert.match(job, /--provenance/)
  assert.match(job, /--access public/)
})
