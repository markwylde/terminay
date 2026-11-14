// Persist only Vite's committed browser optimizer. Its config includes absolute
// aliases and root, so cached output must never cross checkout roots or runtimes.
import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repositoryRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));

export function prebundleCacheEnvironment(root = repositoryRoot, environment = process.env) {
  return {
    ...environment,
    TERMINAY_E2E_VITE_ROOT: realpathSync(root),
    TERMINAY_E2E_VITE_RUNTIME: `${process.platform}-${process.arch}-${process.version}`,
  };
}

/** A killed or partial optimizer must never become a successful cached task. */
export async function verifyCommittedOptimizer(root = repositoryRoot) {
  const directory = join(root, 'node_modules/.vite/deps');
  const metadata = JSON.parse(await readFile(join(directory, '_metadata.json'), 'utf8'));
  if (!metadata.hash || !metadata.configHash || !metadata.lockfileHash || !metadata.browserHash ||
      !metadata.optimized || !Object.keys(metadata.optimized).length || !metadata.chunks)
    throw new Error('Browser fixture optimizer metadata is incomplete');
  if (Object.values(metadata.optimized).some(entry => typeof entry.fileHash !== 'string' || !entry.fileHash))
    throw new Error('Browser fixture optimizer metadata is incomplete');
  for (const [name, entry] of [...Object.entries(metadata.optimized), ...Object.entries(metadata.chunks)]) {
    if (typeof entry.file !== 'string') throw new Error(`Missing optimizer file for ${name}`);
    const file = resolve(directory, entry.file);
    if (!file.startsWith(`${directory}${sep}`) || !(await stat(file)).isFile())
      throw new Error(`Invalid optimizer file for ${name}`);
  }
  return metadata;
}

export async function prebundle({ cached = false, root = repositoryRoot, run = execFileSync, warm } = {}) {
  const started = Date.now();
  if (cached) {
    run('npx', ['turbo', 'run', 'prebundle:e2e-vite'], {
      cwd: root, stdio: 'inherit', timeout: 300_000,
      env: prebundleCacheEnvironment(root),
    });
  } else {
    const warmer = warm ?? (await import('../e2e/support/shared-web-shell-fixture.ts')).prebundleSharedWebShellDependencies;
    await warmer();
  }
  await verifyCommittedOptimizer(root);
  process.stdout.write(`Pre-bundled browser-shell fixture dependencies in ${Date.now() - started}ms${cached ? ' (cache enabled)' : ''}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--cached')) throw new Error('Usage: prebundle-e2e-vite-deps.mjs [--cached]');
  if (!args.includes('--cached') && process.env.TURBO_HASH &&
      (process.env.TERMINAY_E2E_VITE_ROOT !== repositoryRoot ||
       process.env.TERMINAY_E2E_VITE_RUNTIME !== `${process.platform}-${process.arch}-${process.version}`))
    throw new Error('Run the optimizer through prebundle-e2e-vite-deps.mjs --cached to establish its cache identity');
  await prebundle({ cached: args.includes('--cached') });
}
