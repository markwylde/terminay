import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import {
  MAX_NOTES_BYTES,
  MAX_NOTES_ENTRIES,
  assertCountNotBehind,
  formatPrereleaseNotes,
  getPrereleaseVersion,
  publishedCommitCount,
} from './prerelease-version.mjs'
import { compareVersions } from '../electron/appUpdater.ts'
import { nextUpdateProbeVersion } from './update-probe-version.mjs'
import { shouldBuildNightly } from './nightly-skip.mjs'
import { LEGACY_BETA_FEED_UNTIL, legacyBetaFeedActive } from './legacy-beta-feed.mjs'
import { declareMinimumSystemVersion } from './declare-update-minimum-system-version.mjs'
import { UpdateMetadataError, parseUpdateMetadata, verifyUpdateMetadata } from './verify-update-metadata.mjs'

const execFileAsync = promisify(execFile)

function sha512(bytes) {
  return createHash('sha512').update(bytes).digest('base64')
}

// Mirrors what electron-builder 26 writes for a macOS zip (captured from a
// real `electron-builder --mac zip` run with a prerelease version and notes file).
function metadataFor({ version, files, releaseNotes }) {
  const lines = [`version: ${version}`, 'files:']
  for (const file of files) {
    lines.push(`  - url: ${file.url}`, `    sha512: ${file.sha512}`, `    size: ${file.size}`)
  }
  lines.push(`path: ${files[0].url}`, `sha512: ${files[0].sha512}`)
  if (releaseNotes !== undefined) {
    lines.push('releaseNotes: |', ...releaseNotes.split('\n').map((line) => (line ? `  ${line}` : '')))
  }
  lines.push("releaseDate: '2026-09-19T17:30:53.999Z'", '')
  return lines.join('\n')
}

async function fixture(t, { version = '1.2.4-main.3300.nightly', payloads = { 'terminay-desktop-main-mac.zip': 'zip bytes' }, releaseNotes = '- a change\n- another change' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'terminay-update-metadata-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const files = []
  for (const [url, contents] of Object.entries(payloads)) {
    const bytes = Buffer.from(contents)
    await writeFile(join(dir, url), bytes)
    files.push({ url, sha512: sha512(bytes), size: bytes.length })
  }
  const metadataPath = join(dir, 'nightly-mac.yml')
  await writeFile(metadataPath, metadataFor({ version, files, releaseNotes }))
  return { dir, metadataPath, files }
}

async function rejects(promise, pattern) {
  await assert.rejects(promise, (error) => error instanceof UpdateMetadataError && pattern.test(error.message))
}

test('parses the electron-builder update-info shape, including block release notes', () => {
  const parsed = parseUpdateMetadata(
    metadataFor({
      version: '1.2.3',
      files: [
        { url: 'Terminay-Mac-1.2.3.zip', sha512: `${'a'.repeat(86)}==`, size: 12 },
        { url: 'Terminay-Mac-1.2.3-Installer.dmg', sha512: `${'b'.repeat(86)}==`, size: 34 },
      ],
      releaseNotes: '- first\n\n- second',
    }),
  )
  assert.equal(parsed.version, '1.2.3')
  assert.deepEqual(parsed.files.map((file) => file.url), ['Terminay-Mac-1.2.3.zip', 'Terminay-Mac-1.2.3-Installer.dmg'])
  assert.equal(parsed.files[1].size, '34')
  assert.equal(parsed.path, 'Terminay-Mac-1.2.3.zip')
  assert.match(parsed.other.get('releaseNotes'), /- second/u)
  assert.equal(parsed.other.get('releaseDate'), "'2026-09-19T17:30:53.999Z'")
})

test('rejects metadata outside the reviewed shape', () => {
  for (const text of [
    'version: 1.2.3\nversion: 1.2.4\n',
    'version: 1.2.3\nfiles:\n - url: a.zip\n',
    'version: 1.2.3\nfiles:\n  - url: a.zip\n      sha512: x\n',
    'version: 1.2.3\nfiles:\n  - url: a.zip\n    url: b.zip\n',
    'version: 1.2.3\n\tfiles:\n',
    'version: [1.2.3]\n',
    'version: 1.2.3\r\n',
    "version: 'unterminated\n",
  ]) {
    assert.throws(() => parseUpdateMetadata(text), UpdateMetadataError, JSON.stringify(text))
  }
})

test('accepts metadata whose every referenced file matches its published bytes', async (t) => {
  const { dir, metadataPath } = await fixture(t)
  assert.equal(
    await verifyUpdateMetadata({
      metadataPath,
      assetsDir: dir,
      version: '1.2.4-main.3300.nightly',
      expectedFiles: ['terminay-desktop-main-mac.zip'],
      releaseAssetNames: ['nightly-mac.yml', 'terminay-desktop-main-mac.zip', 'terminay-desktop-main-mac.zip.sha256'],
      requireReleaseNotes: true,
    }),
    '1.2.4-main.3300.nightly',
  )
})

test('rejects a digest or size that does not match the payload bytes', async (t) => {
  const { dir, metadataPath } = await fixture(t)
  await writeFile(join(dir, 'terminay-desktop-main-mac.zip'), 'zip bytez')
  await rejects(verifyUpdateMetadata({ metadataPath, assetsDir: dir, expectedFiles: ['terminay-desktop-main-mac.zip'] }), /sha512 does not match/u)
  await writeFile(join(dir, 'terminay-desktop-main-mac.zip'), 'longer zip bytes')
  await rejects(verifyUpdateMetadata({ metadataPath, assetsDir: dir, expectedFiles: ['terminay-desktop-main-mac.zip'] }), /size does not match/u)
})

test('rejects a referenced file that is not an asset of the release', async (t) => {
  const { dir, metadataPath } = await fixture(t)
  await rejects(
    verifyUpdateMetadata({ metadataPath, assetsDir: dir, expectedFiles: ['terminay-desktop-main-mac.zip'], releaseAssetNames: ['nightly-mac.yml'] }),
    /is not an asset of the release/u,
  )
})

test('rejects metadata that references anything but the expected payloads', async (t) => {
  const { dir, metadataPath } = await fixture(t, {
    payloads: { 'terminay-desktop-main-mac.zip': 'zip', 'Terminay-Mac-1.2.3-Installer.dmg': 'dmg' },
  })
  await rejects(verifyUpdateMetadata({ metadataPath, assetsDir: dir, expectedFiles: ['terminay-desktop-main-mac.zip'] }), /expected terminay-desktop-main-mac\.zip/u)
})

test('rejects a version other than the one being published', async (t) => {
  const { dir, metadataPath } = await fixture(t)
  await rejects(verifyUpdateMetadata({ metadataPath, assetsDir: dir, version: '1.2.4-main.3301.nightly', expectedFiles: ['terminay-desktop-main-mac.zip'] }), /is not 1\.2\.4-main\.3301\.nightly/u)
})

test('rejects paths, symlinked payloads, mismatched legacy fields, and missing notes', async (t) => {
  const { dir, metadataPath, files } = await fixture(t)
  const text = await readFile(metadataPath, 'utf8')

  await writeFile(metadataPath, text.replace('  - url: terminay-desktop-main-mac.zip', '  - url: ../terminay-desktop-main-mac.zip'))
  await rejects(verifyUpdateMetadata({ metadataPath, assetsDir: dir, expectedFiles: ['../terminay-desktop-main-mac.zip'] }), /plain release asset name/u)

  await writeFile(metadataPath, text.replace('path: terminay-desktop-main-mac.zip', 'path: other.zip'))
  await rejects(verifyUpdateMetadata({ metadataPath, assetsDir: dir, expectedFiles: ['terminay-desktop-main-mac.zip'] }), /path does not name/u)

  await writeFile(metadataPath, text.replace(`sha512: ${files[0].sha512}\nreleaseNotes`, `sha512: ${'c'.repeat(86)}==\nreleaseNotes`))
  await rejects(verifyUpdateMetadata({ metadataPath, assetsDir: dir, expectedFiles: ['terminay-desktop-main-mac.zip'] }), /sha512 does not match the first/u)

  await writeFile(metadataPath, text.replace(/releaseNotes: \|\n(?: {2}.*\n)+/u, ''))
  await rejects(
    verifyUpdateMetadata({ metadataPath, assetsDir: dir, expectedFiles: ['terminay-desktop-main-mac.zip'], requireReleaseNotes: true }),
    /must carry release notes/u,
  )

  await writeFile(metadataPath, text)
  await rm(join(dir, 'terminay-desktop-main-mac.zip'))
  await mkdir(join(dir, 'elsewhere'))
  await writeFile(join(dir, 'elsewhere', 'payload'), 'zip bytes')
  await symlink(join(dir, 'elsewhere', 'payload'), join(dir, 'terminay-desktop-main-mac.zip'))
  await rejects(verifyUpdateMetadata({ metadataPath, assetsDir: dir, expectedFiles: ['terminay-desktop-main-mac.zip'] }), /must be a regular file/u)
})

test('macOS metadata declares its Darwin floor, and the verifier requires it when asked', async (t) => {
  const { dir, metadataPath } = await fixture(t)
  const text = await readFile(metadataPath, 'utf8')
  const options = { metadataPath, assetsDir: dir, expectedFiles: ['terminay-desktop-main-mac.zip'], minimumSystemVersion: '22.0.0' }

  await rejects(verifyUpdateMetadata(options), /must declare minimum system version 22\.0\.0/u)

  const declared = declareMinimumSystemVersion(text, '22.0.0')
  assert.equal(parseUpdateMetadata(declared).other.get('minimumSystemVersion'), '22.0.0')
  await writeFile(metadataPath, declared)
  assert.equal(await verifyUpdateMetadata(options), '1.2.4-main.3300.nightly')
  await rejects(verifyUpdateMetadata({ ...options, minimumSystemVersion: '23.0.0' }), /must declare minimum system version 23\.0\.0/u)

  assert.throws(() => declareMinimumSystemVersion(declared, '22.0.0'), /already declares/u)
  assert.throws(() => declareMinimumSystemVersion(text, '13.0'), /exact x\.y\.z/u)
})

test('the verifier CLI prints the verified version and fails closed', async (t) => {
  const { dir, metadataPath } = await fixture(t)
  const script = resolve('scripts/verify-update-metadata.mjs')
  const { stdout } = await execFileAsync(process.execPath, [
    script,
    '--metadata', metadataPath,
    '--assets-dir', dir,
    '--expect-file', 'terminay-desktop-main-mac.zip',
    '--require-release-notes',
  ])
  assert.equal(stdout, '1.2.4-main.3300.nightly\n')
  await assert.rejects(
    execFileAsync(process.execPath, [script, '--metadata', metadataPath, '--assets-dir', dir, '--expect-file', 'other.zip']),
    /update metadata verification failed/u,
  )
  await assert.rejects(execFileAsync(process.execPath, [script, '--metadata', metadataPath]), /usage/u)
})

test('prerelease versions lead to the next stable version and carry the commit count and track', () => {
  for (const track of ['nightly', 'canary']) {
    assert.equal(getPrereleaseVersion({ latestTag: 'v4.2.0', messages: ['fix: a bug'], commitCount: 3300, track }), `4.2.1-main.3300.${track}`)
    assert.equal(getPrereleaseVersion({ latestTag: 'v4.2.0', messages: ['feat: a thing'], commitCount: '3301', track }), `4.3.0-main.3301.${track}`)
    assert.equal(getPrereleaseVersion({ latestTag: 'v4.2.0', messages: ['feat!: break'], commitCount: 3302, track }), `5.0.0-main.3302.${track}`)
    // Built exactly at a tag, the prerelease still names something newer than it.
    assert.equal(getPrereleaseVersion({ latestTag: 'v4.2.0', messages: [], commitCount: 3303, track }), `4.2.1-main.3303.${track}`)
    assert.equal(getPrereleaseVersion({ latestTag: null, messages: ['feat: first'], commitCount: 1, track }), `0.1.0-main.1.${track}`)
  }
  for (const commitCount of [0, '01', '-1', '1.5', 'x']) {
    assert.throws(() => getPrereleaseVersion({ latestTag: 'v4.2.0', messages: [], commitCount, track: 'nightly' }), /commit count/u)
  }
  for (const track of ['beta', 'stable', 'main', '']) {
    assert.throws(() => getPrereleaseVersion({ latestTag: 'v4.2.0', messages: [], commitCount: 1, track }), /track/u)
  }
  assert.throws(() => getPrereleaseVersion({ latestTag: 'v4.2.0-rc.1', messages: [], commitCount: 1, track: 'canary' }), /release tag/u)
})

test('prerelease versions order by commit across tracks, then nightly above canary', () => {
  // A later commit on the other track sorts higher, either way round.
  assert.ok(compareVersions('6.3.0-main.3312.canary', '6.3.0-main.3300.nightly') > 0)
  assert.ok(compareVersions('6.3.0-main.3312.nightly', '6.3.0-main.3300.canary') > 0)
  // The count compares as a number, not as text.
  assert.ok(compareVersions('6.3.0-main.10000.canary', '6.3.0-main.9999.nightly') > 0)
  // On one commit, only the track decides.
  assert.ok(compareVersions('6.3.0-main.3312.nightly', '6.3.0-main.3312.canary') > 0)
  // Stable is above every prerelease that led to it, and the next prerelease is above stable.
  assert.ok(compareVersions('6.3.0', '6.3.0-main.3312.canary') > 0)
  assert.ok(compareVersions('6.3.0', '6.3.0-main.3312.nightly') > 0)
  assert.ok(compareVersions('6.3.1-main.3313.canary', '6.3.0') > 0)
  // Every old beta sorts below the new form on its base version, and below a higher base.
  assert.ok(compareVersions('6.3.0-beta.9999', '6.3.0-main.1.canary') < 0)
  assert.ok(compareVersions('6.3.0-beta.812', '6.3.0-main.3300.nightly') < 0)
  assert.ok(compareVersions('6.3.0-beta.812', '6.4.0-main.1.canary') < 0)
})

test("a prerelease refuses a commit count below its track's published build", () => {
  assert.equal(publishedCommitCount({ commit: 'a'.repeat(40), version: '6.3.0-main.3312.canary' }), 3312)
  assert.equal(publishedCommitCount({ version: '6.3.0-beta.812' }), null)
  assert.equal(publishedCommitCount(null), null)
  assertCountNotBehind({ commitCount: '3312', buildJson: { version: '6.3.0-main.3312.canary' } })
  assertCountNotBehind({ commitCount: '3313', buildJson: { version: '6.3.0-main.3312.canary' } })
  // Nothing published yet, or nothing comparable: the first build of a track.
  assertCountNotBehind({ commitCount: '1', buildJson: null })
  assert.throws(
    () => assertCountNotBehind({ commitCount: '3290', buildJson: { version: '6.3.0-main.3312.nightly' } }),
    /below the published build's 3312/u,
  )
})

test('the version script fails when the published build of its track is ahead', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'terminay-prerelease-version-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const repo = (...args) => execFileAsync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: dir })
  await repo('init', '-q')
  await repo('commit', '-q', '--allow-empty', '-m', 'feat: first')
  await repo('tag', 'v1.0.0')
  await repo('commit', '-q', '--allow-empty', '-m', 'fix: second')
  const script = resolve('scripts/prerelease-version.mjs')
  const published = join(dir, 'build.json')
  await writeFile(published, JSON.stringify({ commit: 'a'.repeat(40), version: '1.0.1-main.2.canary' }))
  const { stdout } = await execFileAsync(process.execPath, [script, '--track', 'canary', '--notes-out', join(dir, 'notes.md'), '--published-build', published], { cwd: dir })
  assert.equal(stdout, '1.0.1-main.2.canary\n')
  assert.equal(await readFile(join(dir, 'notes.md'), 'utf8'), '- fix: second\n')
  // A missing build.json is the first build of a track.
  const fresh = await execFileAsync(process.execPath, [script, '--track', 'nightly', '--notes-out', join(dir, 'fresh.md'), '--published-build', join(dir, 'absent.json')], { cwd: dir })
  assert.equal(fresh.stdout, '1.0.1-main.2.nightly\n')
  await writeFile(published, JSON.stringify({ commit: 'a'.repeat(40), version: '1.0.1-main.9.canary' }))
  await assert.rejects(
    execFileAsync(process.execPath, [script, '--track', 'canary', '--notes-out', join(dir, 'behind.md'), '--published-build', published], { cwd: dir }),
    /below the published build's 9/u,
  )
  await assert.rejects(execFileAsync(process.execPath, [script, '--track', 'beta', '--notes-out', join(dir, 'beta.md')], { cwd: dir }), /Invalid track/u)
})

test('prerelease release notes list commit subjects and stay bounded', () => {
  assert.equal(
    formatPrereleaseNotes({ latestTag: 'v4.2.0', subjects: ['feat: one', 'fix:  two\tspaced'] }),
    '- feat: one\n- fix: two spaced\n',
  )
  assert.equal(formatPrereleaseNotes({ latestTag: 'v4.2.0', subjects: [] }), '- No changes since v4.2.0.\n')

  const many = formatPrereleaseNotes({ latestTag: 'v4.2.0', subjects: Array.from({ length: 500 }, (_, i) => `fix: ${i}`) })
  assert.equal(many.split('\n').filter(Boolean).length, MAX_NOTES_ENTRIES + 1)
  assert.match(many, /- …and 300 more commits\.\n$/u)

  const long = formatPrereleaseNotes({ latestTag: 'v4.2.0', subjects: Array.from({ length: 50 }, () => 'x'.repeat(1000)) })
  assert.ok(Buffer.byteLength(long) < MAX_NOTES_BYTES + 100)
  assert.match(long, /more commits\.\n$/u)
})

test("the Windows update probe's next version is one commit later on a prerelease track", () => {
  assert.equal(nextUpdateProbeVersion('6.3.0'), '6.3.1-update-probe')
  assert.equal(nextUpdateProbeVersion('6.3.0-main.3300.nightly'), '6.3.0-main.3301.nightly')
  assert.equal(nextUpdateProbeVersion('6.3.0-main.3312.canary'), '6.3.0-main.3313.canary')
  for (const version of ['6.3.0', '6.3.0-main.3300.nightly', '6.3.0-main.3312.canary'])
    assert.ok(compareVersions(nextUpdateProbeVersion(version), version) > 0, version)
  for (const version of ['6.3.0-beta.4', 'v6.3.0', '6.3.0-main.0.canary', 'x'])
    assert.throws(() => nextUpdateProbeVersion(version), /Not a stable, nightly or canary version/u)
})

test('a nightly builds only when main moved past the published nightly', () => {
  const head = 'a'.repeat(40)
  // Equal: tonight's head is already published.
  assert.equal(shouldBuildNightly({ headCommit: head, buildJson: { commit: head, version: '6.3.0-main.3300.nightly' } }), false)
  // Different: main has moved, or last night failed before publication.
  assert.equal(shouldBuildNightly({ headCommit: head, buildJson: { commit: 'b'.repeat(40), version: '6.3.0-main.3299.nightly' } }), true)
  // Missing or unreadable: nothing proves a publication, so build.
  assert.equal(shouldBuildNightly({ headCommit: head, buildJson: null }), true)
  assert.equal(shouldBuildNightly({ headCommit: head, buildJson: { version: 'x' } }), true)
  assert.throws(() => shouldBuildNightly({ headCommit: 'main', buildJson: null }), /full commit/u)
})

test('the nightly skip CLI reads build.json and prints a workflow output', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'terminay-nightly-skip-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const script = resolve('scripts/nightly-skip.mjs')
  const head = 'c'.repeat(40)
  const file = join(dir, 'build.json')
  const run = async () => (await execFileAsync(process.execPath, [script, '--head', head, '--build-json', file])).stdout
  assert.equal(await run(), 'build=true\n')
  await writeFile(file, 'not json')
  assert.equal(await run(), 'build=true\n')
  await writeFile(file, JSON.stringify({ commit: head, version: '6.3.0-main.3300.nightly' }))
  assert.equal(await run(), 'build=false\n')
  await writeFile(file, JSON.stringify({ commit: 'd'.repeat(40), version: '6.3.0-main.3299.nightly' }))
  assert.equal(await run(), 'build=true\n')
})

test('the legacy beta feed is published through its end date and not after', async () => {
  assert.equal(LEGACY_BETA_FEED_UNTIL, '2027-02-09')
  assert.equal(legacyBetaFeedActive(new Date('2026-11-11T02:00:00Z')), true)
  assert.equal(legacyBetaFeedActive(new Date('2027-02-09T00:00:00Z')), true)
  assert.equal(legacyBetaFeedActive(new Date('2027-02-09T23:59:59Z')), true)
  assert.equal(legacyBetaFeedActive(new Date('2027-02-10T00:00:00Z')), false)
  assert.equal(legacyBetaFeedActive(new Date('2027-06-01T02:00:00Z')), false)
  assert.throws(() => legacyBetaFeedActive(new Date('x')), /valid current time/u)
  const script = resolve('scripts/legacy-beta-feed.mjs')
  assert.equal((await execFileAsync(process.execPath, [script, '--now', '2027-02-09T12:00:00Z'])).stdout, 'true\n')
  assert.equal((await execFileAsync(process.execPath, [script, '--now', '2027-02-10T00:00:00Z'])).stdout, 'false\n')
})

// The selection step is executed, not just read: a stale or unexpected
// payload beside the reviewed set must fail packaging.
async function selectionScript() {
  const workflow = await readFile(resolve('.github/workflows/trigger-release.yml'), 'utf8')
  const start = workflow.indexOf('- name: Verify exact release asset selection\n')
  const step = workflow.slice(start, workflow.indexOf('- name:', start + 1))
  const body = step.slice(step.indexOf('run: |\n') + 'run: |\n'.length)
  return body
    .split('\n')
    .map((line) => (line.startsWith('          ') ? line.slice(10) : line.trim() === '' ? '' : null))
    .filter((line) => line !== null)
    .join('\n')
}

async function runSelection(t, files) {
  const dir = await mkdtemp(join(tmpdir(), 'terminay-asset-selection-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  for (const file of files) {
    await mkdir(join(dir, file, '..'), { recursive: true })
    await writeFile(join(dir, file), 'x')
  }
  const output = join(dir, 'github-output')
  await writeFile(output, '')
  await execFileAsync('bash', ['-euo', 'pipefail', '-c', await selectionScript()], {
    cwd: dir,
    env: {
      PATH: process.env.PATH,
      TAG: 'v1.2.3',
      ASSET_TEMPLATES: 'Terminay-Mac-%VERSION%-Installer.dmg Terminay-Mac-%VERSION%.zip Terminay-Mac-%VERSION%.zip.blockmap',
      UPDATE_METADATA: 'latest-mac.yml',
      GITHUB_OUTPUT: output,
    },
  })
  return readFile(output, 'utf8')
}

const macBuild = [
  'release/1.2.3/Terminay-Mac-1.2.3-Installer.dmg',
  'release/1.2.3/Terminay-Mac-1.2.3.zip',
  'release/1.2.3/Terminay-Mac-1.2.3.zip.blockmap',
  'release/1.2.3/latest-mac.yml',
  'release/1.2.3/builder-debug.yml',
  // Files inside the unpacked app are never payloads.
  'release/1.2.3/mac-arm64/Terminay.app/Contents/Resources/archive.zip',
]

test('release asset selection publishes exactly the reviewed payloads and keeps metadata separate', async (t) => {
  const output = await runSelection(t, macBuild)
  assert.match(output, /^files=release\/1\.2\.3\/Terminay-Mac-1\.2\.3-Installer\.dmg release\/1\.2\.3\/Terminay-Mac-1\.2\.3\.zip release\/1\.2\.3\/Terminay-Mac-1\.2\.3\.zip\.blockmap$/mu)
  assert.match(output, /^metadata=release\/1\.2\.3\/latest-mac\.yml$/mu)
  const paths = output.slice(output.indexOf('artifact_paths<<'), output.lastIndexOf('TERMINAY_RELEASE_ASSET_PATHS')).split('\n').slice(1).filter(Boolean)
  assert.deepEqual(paths, [
    'release/1.2.3/Terminay-Mac-1.2.3-Installer.dmg',
    'release/1.2.3/Terminay-Mac-1.2.3-Installer.dmg.sha256',
    'release/1.2.3/Terminay-Mac-1.2.3.zip',
    'release/1.2.3/Terminay-Mac-1.2.3.zip.sha256',
    'release/1.2.3/Terminay-Mac-1.2.3.zip.blockmap',
    'release/1.2.3/Terminay-Mac-1.2.3.zip.blockmap.sha256',
  ])
})

test('release asset selection fails on a stale payload, a missing payload, or a second metadata file', async (t) => {
  await assert.rejects(runSelection(t, [...macBuild, 'release/1.2.2/Terminay-Mac-1.2.2.zip']))
  await assert.rejects(runSelection(t, [...macBuild, 'release/1.2.3/Terminay-Mac-1.2.3-Installer.dmg.blockmap']))
  await assert.rejects(runSelection(t, macBuild.filter((file) => !file.endsWith('.zip.blockmap'))))
  await assert.rejects(runSelection(t, [...macBuild, 'release/1.2.3/beta-mac.yml']))
  await assert.rejects(runSelection(t, [...macBuild, 'release/1.2.3/nightly-mac.yml']))
  await assert.rejects(runSelection(t, [...macBuild, 'release/1.2.3/canary-mac.yml']))
  await assert.rejects(runSelection(t, macBuild.filter((file) => !file.endsWith('latest-mac.yml'))))
})
