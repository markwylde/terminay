import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { describeArtifactFiles, normalizeArtifactModes, walkRegularTree } from './artifact-determinism.mjs'
import { PTY_RUNTIME_PLATFORMS } from './pty-runtime-platforms.mjs'

test('artifact inventory is sorted, hashed, and rejects symbolic links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminay-artifact-tree-'))
  try {
    await mkdir(join(root, 'nested'))
    await writeFile(join(root, 'z.txt'), 'z')
    await writeFile(join(root, 'nested', 'a.txt'), 'a')
    await normalizeArtifactModes(root)
    assert.deepEqual(await describeArtifactFiles(root), [
      { path: 'nested/a.txt', mode: '644', size: 1, sha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb' },
      { path: 'z.txt', mode: '644', size: 1, sha256: '594e519ae499312b29433b7dd8a97ff068defcba9755b6d5d00e84c524d67b06' },
    ])
    await symlink(join(root, 'z.txt'), join(root, 'linked.txt'))
    await assert.rejects(() => walkRegularTree(root), /symbolic link/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the standalone builder gates architecture on the shipped ELF bytes, not on the runner', async (t) => {
  // The builder refuses every non-Linux host before it reaches either gate, so
  // the two are only distinguishable on a release-shaped runner.
  if (process.platform !== 'linux') return t.skip('requires a Linux runner')
  const scratch = await mkdtemp(join(tmpdir(), 'terminay-builder-gate-'))
  try {
    const nodeArchive = join(scratch, 'node.tar.xz')
    await writeFile(nodeArchive, 'not the pinned archive')
    const common = [
      '--node-archive', nodeArchive,
      '--runtime-modules', join(scratch, 'node_modules'),
      '--output-dir', join(scratch, 'out'),
      '--webrtc-runtime', join(scratch, 'webrtc-runtime'),
      '--revision', 'd'.repeat(40),
    ]
    for (const target of Object.keys(PTY_RUNTIME_PLATFORMS)) {
      const architecture = PTY_RUNTIME_PLATFORMS[target].architecture
      const permissive = await runBuilder(['--target', target, ...common])
      assert.doesNotMatch(permissive.stderr, /requires native/u, `${target} must stage on a non-native runner`)
      assert.match(permissive.stderr, /pinned Node archive SHA-256/u, `${target} must still verify the bytes it stages`)

      const strict = await runBuilder(['--target', target, ...common, '--require-native-runner', 'true'])
      if (architecture === process.arch) assert.match(strict.stderr, /pinned Node archive SHA-256/u)
      else assert.match(strict.stderr, new RegExp(`${target} requires native ${architecture}`, 'u'))
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})

test('the archive launcher reports the release version it was built from', async () => {
  // A published archive is installed by copying it onto a box, so nothing
  // outside it can supply the version. Without this the server falls back to
  // the workspace placeholder and an operator checking the version output
  // before an upgrade is told 0.0.0 for every release.
  const builder = await readFile(new URL('build-standalone-server-artifact.mjs', import.meta.url), 'utf8')
  assert.match(builder, /writeLaunchers\(root, serverPackage\.version\)/u)
  const launcher = builder.slice(builder.indexOf('async function writeLaunchers'))
  assert.match(launcher, /TERMINAY_SERVER_VERSION:=\$\{version\}/u)
  assert.match(launcher, /export TERMINAY_SERVER_VERSION /u)

  // The probe refuses an archive whose launcher and manifest disagree.
  const probe = await readFile(new URL('probe-standalone-server-archive.mjs', import.meta.url), 'utf8')
  assert.match(probe, /version !== manifest\.version/u)
})

function runBuilder(args) {
  return new Promise((resolve, reject) => {
    const script = fileURLToPath(new URL('build-standalone-server-artifact.mjs', import.meta.url))
    const child = spawn(process.execPath, [script, ...args], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => resolve({ code, stdout, stderr }))
  })
}

test('direct image payload and distribution archive preserve identical verified bytes and modes', async () => {
  const { publishStandalonePayload } = await import('./publish-standalone-payload.mjs');
  const { cp, chmod } = await import('node:fs/promises');
  const { execFileSync } = await import('node:child_process');
  const root = await mkdtemp(join(tmpdir(), 'terminay-unpacked-artifact-'));
  try {
    const source = join(root, 'source');
    const name = 'terminay-server-fixture';
    await mkdir(join(source, name, 'bin'), { recursive: true });
    await writeFile(join(source, name, 'bin/node'), 'runtime');
    await chmod(join(source, name, 'bin/node'), 0o755);
    await writeFile(join(source, name, 'artifact-manifest.json'), JSON.stringify({ files: [{ path: 'bin/node', mode: '755' }] }));
    const expected = await describeArtifactFiles(join(source, name));
    await cp(source, join(root, 'archive-source'), { recursive: true });
    const archived = await publishStandalonePayload({ stagingDirectory: join(root, 'archive-source'), rootName: name, outputDirectory: join(root, 'archives') });
    const tree = await publishStandalonePayload({ stagingDirectory: source, rootName: name, outputTree: join(root, 'image/terminay') });
    assert.equal(tree.archivePath, undefined, 'image publication does not compress an archive');
    await mkdir(join(root, 'extracted'));
    execFileSync('tar', ['--same-permissions', '-xzf', archived.archivePath, '-C', join(root, 'extracted')], { timeout: 5000 });
    assert.deepEqual(await describeArtifactFiles(tree.rootDirectory), expected);
    assert.deepEqual(await describeArtifactFiles(join(root, 'extracted', name)), expected);
    await assert.rejects(publishStandalonePayload({ stagingDirectory: source, rootName: name, outputTree: tree.rootDirectory }), /Output already exists/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('fast CI compression preserves reproducible tar bytes, metadata, payload modes and digests', async () => {
  const { publishStandalonePayload } = await import('./publish-standalone-payload.mjs');
  const { chmod, utimes } = await import('node:fs/promises');
  const { execFileSync } = await import('node:child_process');
  const { gunzipSync } = await import('node:zlib');
  const { sha256File } = await import('./artifact-determinism.mjs');
  const root = await mkdtemp(join(tmpdir(), 'terminay-compression-parity-'));
  try {
    const stagingDirectory = join(root, 'staged');
    const rootName = 'terminay-server-fixture';
    const payload = join(stagingDirectory, rootName);
    await mkdir(join(payload, 'bin'), { recursive: true });
    await writeFile(join(payload, 'bin/node'), Buffer.from('native-runtime-content\0'.repeat(4096)));
    await chmod(join(payload, 'bin/node'), 0o755);
    await writeFile(join(payload, 'artifact-manifest.json'), JSON.stringify({ version: 'fixture', files: [{ path: 'bin/node', mode: '755' }] }));
    const inventory = await describeArtifactFiles(payload);
    const archives = [];
    for (const [index, compressionLevel] of [undefined, 9, 1, 1].entries()) {
      // Input/output timestamps and archive paths differ between repetitions.
      await utimes(join(payload, 'bin/node'), 1000 + index, 2000 + index);
      const published = await publishStandalonePayload({ stagingDirectory, rootName, outputDirectory: join(root, `archive-${index}`), ...(compressionLevel === undefined ? {} : { compressionLevel }) });
      assert.equal(published.archiveSha256, await sha256File(published.archivePath));
      const bytes = await readFile(published.archivePath);
      assert.equal(bytes.readUInt32LE(4), 0, 'gzip omits source timestamps');
      assert.equal(bytes[3] & 8, 0, 'gzip omits source filenames');
      archives.push(bytes);
      const extracted = join(root, `extracted-${index}`);
      await mkdir(extracted);
      execFileSync('tar', ['--same-permissions', '-xzf', published.archivePath, '-C', extracted], { timeout: 5000 });
      assert.deepEqual(await describeArtifactFiles(join(extracted, rootName)), inventory);
    }
    assert.deepEqual(archives[0], archives[1], 'release callers still default to level 9');
    assert.deepEqual(archives[2], archives[3], 'level 1 remains byte-reproducible');
    assert.equal(archives[0][8], 2, 'default uses gzip maximum compression');
    assert.equal(archives[2][8], 4, 'explicit CI option reaches the gzip compressor');
    for (const bytes of archives.slice(1)) assert.deepEqual(gunzipSync(bytes), gunzipSync(archives[0]), 'compression levels preserve the exact normalized tar');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('invalid archive compression levels fail before building or touching output', async () => {
  const { createDeterministicTarGz } = await import('./artifact-determinism.mjs');
  for (const compressionLevel of [0, 10, -1, 1.5, '1', NaN]) {
    await assert.rejects(createDeterministicTarGz({ compressionLevel, archivePath: '/missing/output.tar.gz', rootName: 'payload', stagingDirectory: '/missing' }), /compression level must be an integer from 1 to 9/u);
  }
  const cli = await runBuilder(['--compression-level', '0']);
  assert.notEqual(cli.code, 0);
  assert.match(cli.stderr, /compression level must be an integer from 1 to 9/u);
  const { execFileSync } = await import('node:child_process');
  assert.throws(() => execFileSync('sh', [fileURLToPath(new URL('./build-linux-standalone-archive.sh', import.meta.url)), '--prebuilt', '--compression-level', '0'], { encoding: 'utf8', timeout: 5000, stdio: 'pipe' }), error => {
    assert.match(error.stderr, /Compression level must be an integer from 1 to 9/u);
    return true;
  });
});
