import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';

function manifest(path) {
  return JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
}

function sharedPackages(root) {
  const directory = join(root, 'packages');
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(directory, entry.name, 'package.json')))
    .map((entry) => join(directory, entry.name))
    .filter((path) => typeof manifest(path).scripts?.build === 'string');
}

function hashDirectory(directory) {
  const hash = createHash('sha256');
  const files = [];
  const visit = (path) => {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = join(path, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) files.push(target);
    }
  };
  visit(directory);
  for (const file of files) {
    hash.update(relative(directory, file).split('\\').join('/'));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return { digest: hash.digest('hex'), files: files.length };
}

function build(root, packageName) {
  execFileSync('npm', ['run', 'build', '--workspace', packageName], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, npm_config_loglevel: 'error' },
  });
}

function removeIncrementalState(directory) {
  // TypeScript trusts this file even when dist/ has been removed. A clean
  // artifact check must remove both outputs so each build actually emits its
  // declared files, just as a clean checkout does.
  rmSync(join(directory, 'tsconfig.tsbuildinfo'), { force: true });
}

export function checkDeterministicBuilds(rootDirectory = process.cwd()) {
  const root = resolve(rootDirectory);
  const results = [];
  const staging = join(root, '.tmp-deterministic-workspace-builds');
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  try {
    for (const directory of sharedPackages(root)) {
      const packageManifest = manifest(directory);
      const output = join(directory, packageManifest.buildOutput ?? 'dist');
      rmSync(output, { recursive: true, force: true });
      removeIncrementalState(directory);
      build(root, packageManifest.name);
      const first = hashDirectory(output);
      const firstCopy = join(staging, packageManifest.name.replaceAll('/', '__'));
      cpSync(output, firstCopy, { recursive: true });
      rmSync(output, { recursive: true, force: true });
      removeIncrementalState(directory);
      build(root, packageManifest.name);
      const second = hashDirectory(output);
      if (first.digest !== second.digest || first.files !== second.files) {
        throw new Error(`non-deterministic build output for ${packageManifest.name}: ${first.digest} != ${second.digest}`);
      }
      results.push({ name: packageManifest.name, digest: first.digest, files: first.files });
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const results = checkDeterministicBuilds();
  if (results.length === 0) console.log('No buildable shared packages found');
  else for (const result of results) console.log(`${result.name}: ${result.files} files sha256=${result.digest}`);
}
