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
  formatBetaReleaseNotes,
  getBetaVersion,
} from './main-beta-version.mjs'
import { UpdateMetadataError, parseUpdateMetadata, verifyUpdateMetadata } from './verify-update-metadata.mjs'

const execFileAsync = promisify(execFile)

function sha512(bytes) {
  return createHash('sha512').update(bytes).digest('base64')
}

// Mirrors what electron-builder 26 writes for a macOS zip (captured from a
// real `electron-builder --mac zip` run with a beta version and notes file).
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

async function fixture(t, { version = '1.2.4-beta.7', payloads = { 'terminay-desktop-main-mac.zip': 'zip bytes' }, releaseNotes = '- a change\n- another change' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'terminay-update-metadata-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const files = []
  for (const [url, contents] of Object.entries(payloads)) {
    const bytes = Buffer.from(contents)
    await writeFile(join(dir, url), bytes)
    files.push({ url, sha512: sha512(bytes), size: bytes.length })
  }
  const metadataPath = join(dir, 'beta-mac.yml')
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
      version: '1.2.4-beta.7',
      expectedFiles: ['terminay-desktop-main-mac.zip'],
      releaseAssetNames: ['beta-mac.yml', 'terminay-desktop-main-mac.zip', 'terminay-desktop-main-mac.zip.sha256'],
      requireReleaseNotes: true,
    }),
    '1.2.4-beta.7',
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
    verifyUpdateMetadata({ metadataPath, assetsDir: dir, expectedFiles: ['terminay-desktop-main-mac.zip'], releaseAssetNames: ['beta-mac.yml'] }),
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
  await rejects(verifyUpdateMetadata({ metadataPath, assetsDir: dir, version: '1.2.4-beta.8', expectedFiles: ['terminay-desktop-main-mac.zip'] }), /is not 1\.2\.4-beta\.8/u)
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
  assert.equal(stdout, '1.2.4-beta.7\n')
  await assert.rejects(
    execFileAsync(process.execPath, [script, '--metadata', metadataPath, '--assets-dir', dir, '--expect-file', 'other.zip']),
    /update metadata verification failed/u,
  )
  await assert.rejects(execFileAsync(process.execPath, [script, '--metadata', metadataPath]), /usage/u)
})

test('beta versions lead to the next stable version and grow with the run number', () => {
  assert.equal(getBetaVersion({ latestTag: 'v4.2.0', messages: ['fix: a bug'], runNumber: 17 }), '4.2.1-beta.17')
  assert.equal(getBetaVersion({ latestTag: 'v4.2.0', messages: ['feat: a thing'], runNumber: '18' }), '4.3.0-beta.18')
  assert.equal(getBetaVersion({ latestTag: 'v4.2.0', messages: ['feat!: break'], runNumber: 19 }), '5.0.0-beta.19')
  // Built exactly at a tag, the beta still names something newer than it.
  assert.equal(getBetaVersion({ latestTag: 'v4.2.0', messages: [], runNumber: 20 }), '4.2.1-beta.20')
  assert.equal(getBetaVersion({ latestTag: null, messages: ['feat: first'], runNumber: 1 }), '0.1.0-beta.1')
  for (const runNumber of [0, '01', '-1', '1.5', 'x']) {
    assert.throws(() => getBetaVersion({ latestTag: 'v4.2.0', messages: [], runNumber }), /run number/u)
  }
  assert.throws(() => getBetaVersion({ latestTag: 'v4.2.0-rc.1', messages: [], runNumber: 1 }), /release tag/u)
})

test('beta release notes list commit subjects and stay bounded', () => {
  assert.equal(
    formatBetaReleaseNotes({ latestTag: 'v4.2.0', subjects: ['feat: one', 'fix:  two\tspaced'] }),
    '- feat: one\n- fix: two spaced\n',
  )
  assert.equal(formatBetaReleaseNotes({ latestTag: 'v4.2.0', subjects: [] }), '- No changes since v4.2.0.\n')

  const many = formatBetaReleaseNotes({ latestTag: 'v4.2.0', subjects: Array.from({ length: 500 }, (_, i) => `fix: ${i}`) })
  assert.equal(many.split('\n').filter(Boolean).length, MAX_NOTES_ENTRIES + 1)
  assert.match(many, /- …and 300 more commits\.\n$/u)

  const long = formatBetaReleaseNotes({ latestTag: 'v4.2.0', subjects: Array.from({ length: 50 }, () => 'x'.repeat(1000)) })
  assert.ok(Buffer.byteLength(long) < MAX_NOTES_BYTES + 100)
  assert.match(long, /more commits\.\n$/u)
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
  await assert.rejects(runSelection(t, macBuild.filter((file) => !file.endsWith('latest-mac.yml'))))
})
