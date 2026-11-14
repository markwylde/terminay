import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const textDigest = value => createHash('sha256').update(value).digest('hex');
const tar = args => execFileSync('tar', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });

/** Validate member paths and kinds before extracting anything on the host. */
function archiveRoot(archive) {
  const names = tar(['-tzf', archive]).split('\n').filter(Boolean).map(name => name.replace(/\/$/u, ''));
  if (!names.length || names.some(name => name.startsWith('/') || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..'))) throw new Error('Unsafe systemd archive member path');
  if (new Set(names).size !== names.length) throw new Error('Duplicate systemd archive member path');
  const roots = new Set(names.map(name => name.split('/')[0]));
  if (roots.size !== 1) throw new Error('Systemd archive needs one root');
  const [root] = roots;
  if (!/^terminay-server-node24\.15\.0-linux-(?:x64|arm64)$/u.test(root)) throw new Error('Invalid systemd archive root');
  for (const line of tar(['-tvzf', archive]).split('\n').filter(Boolean)) {
    if (!/^[d-][rwx-]{9}\s/u.test(line)) throw new Error('Systemd archive contains a link, special file or special permission');
  }
  return root;
}

/** Prepare one immutable source-channel archive for independent scenario containers. */
export async function prepareSystemdSourceArchive(originalArchive) {
  const started = Date.now();
  const original = resolve(originalArchive);
  const temporary = mkdtempSync(join(tmpdir(), 'terminay-systemd-source-'));
  try {
    const rootName = archiveRoot(original);
    const target = rootName.endsWith('linux-x64') ? 'linux-x64' : 'linux-arm64';
    tar(['--same-permissions', '--no-same-owner', '-xzf', original, '-C', temporary]);
    const root = join(temporary, rootName);
    const { validateExtractedArchive } = await import('./probe-standalone-server-archive.mjs');
    const originalManifest = await validateExtractedArchive(root, target);
    const originalManifestBytes = readFileSync(join(root, 'artifact-manifest.json'), 'utf8');
    const preparedManifestBytes = `${JSON.stringify({ ...originalManifest, channel: 'source' }, null, 2)}\n`;
    writeFileSync(join(root, 'artifact-manifest.json'), preparedManifestBytes);
    await validateExtractedArchive(root, target, { channel: 'source', revision: originalManifest.revision });
    const archivePath = join(temporary, 'prepared-source.tar.gz');
    tar(['--format=gnu', '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-I', 'gzip -1', '-cf', archivePath, '-C', temporary, rootName]);
    const provenance = {
      version: 1, rootName, target, revision: originalManifest.revision,
      originalSha256: digest(original), preparedSha256: digest(archivePath),
      originalManifestSha256: textDigest(originalManifestBytes), preparedManifestSha256: textDigest(preparedManifestBytes),
    };
    const provenancePath = join(temporary, 'provenance.json');
    writeFileSync(provenancePath, `${JSON.stringify(provenance)}\n`, { mode: 0o600 });
    rmSync(root, { recursive: true, force: true });
    console.log(`Prepared one source archive for systemd scenarios in ${Date.now() - started}ms`);
    return { archivePath, provenancePath, close: () => rmSync(temporary, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

/** Internal child flag: bind both archives and the sole permitted manifest edit. */
export function verifyPreparedSystemdSourceArchive(original, prepared, provenancePath) {
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
  if (provenance.version !== 1 || !/^terminay-server-node24\.15\.0-linux-(?:x64|arm64)$/u.test(provenance.rootName ?? '') ||
      !/^[a-f0-9]{40}$/u.test(provenance.revision ?? '') ||
      !['originalSha256', 'preparedSha256', 'originalManifestSha256', 'preparedManifestSha256'].every(key => /^[a-f0-9]{64}$/u.test(provenance[key] ?? '')))
    throw new Error('Invalid prepared systemd archive provenance');
  if (digest(original) !== provenance.originalSha256 || digest(prepared) !== provenance.preparedSha256) throw new Error('Prepared systemd archive digest mismatch');
  const manifestPath = `${provenance.rootName}/artifact-manifest.json`;
  const originalBytes = tar(['--occurrence=1', '-xOzf', original, manifestPath]);
  const preparedBytes = tar(['--occurrence=1', '-xOzf', prepared, manifestPath]);
  if (textDigest(originalBytes) !== provenance.originalManifestSha256 || textDigest(preparedBytes) !== provenance.preparedManifestSha256) throw new Error('Prepared systemd manifest digest mismatch');
  const originalManifest = JSON.parse(originalBytes), preparedManifest = JSON.parse(preparedBytes);
  if (preparedManifest.channel !== 'source' || preparedManifest.target !== provenance.target || preparedManifest.revision !== provenance.revision ||
      JSON.stringify(preparedManifest) !== JSON.stringify({ ...originalManifest, channel: 'source' })) throw new Error('Prepared systemd archive provenance mismatch');
  return provenance;
}
