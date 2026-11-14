import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cpSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prebundle, prebundleCacheEnvironment, verifyCommittedOptimizer } from './prebundle-e2e-vite-deps.mjs';

async function optimizer(root) {
  const directory = join(root, 'node_modules/.vite/deps');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'react.js'), 'export const fixture = true;');
  await writeFile(join(directory, 'chunk.js'), 'export const shared = true;');
  await writeFile(join(directory, '_metadata.json'), JSON.stringify({ hash: 'hash', configHash: 'config', lockfileHash: 'lock', browserHash: 'browser', optimized: { react: { file: 'react.js', fileHash: 'file' } }, chunks: { shared: { file: 'chunk.js' } } }));
  return directory;
}

test('a restored committed optimizer is validated and absolute roots separate cache identities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminay-vite-cache-test-'));
  try {
    const saved = await optimizer(join(root, 'saved'));
    await prebundle({ cached: true, root, run: (command, args, options) => {
      assert.equal(command, 'npx');
      assert.deepEqual(args, ['turbo', 'run', 'prebundle:e2e-vite']);
      assert.equal(options.timeout, 300000);
      assert.equal(options.env.TERMINAY_E2E_VITE_ROOT, root);
      assert.equal(options.env.TERMINAY_E2E_VITE_RUNTIME, `${process.platform}-${process.arch}-${process.version}`);
      // Restore the same committed directory a real cache archive contains.
      mkdirSync(join(root, 'node_modules/.vite'), { recursive: true });
      cpSync(saved, join(root, 'node_modules/.vite/deps'), { recursive: true });
    }, warm: () => assert.fail('a cache restore must not invoke the warmer') });
    assert.equal((await verifyCommittedOptimizer(root)).configHash, 'config');
    assert.notEqual(prebundleCacheEnvironment(root).TERMINAY_E2E_VITE_ROOT, prebundleCacheEnvironment(join(root, 'saved')).TERMINAY_E2E_VITE_ROOT);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a warm task cannot cache incomplete metadata or missing optimizer chunks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminay-vite-cache-incomplete-'));
  try {
    const directory = await optimizer(root);
    await rm(join(directory, 'chunk.js'));
    await assert.rejects(prebundle({ root, warm: async () => {} }), /ENOENT/u);
    await writeFile(join(directory, '_metadata.json'), JSON.stringify({ optimized: {} }));
    await assert.rejects(verifyCommittedOptimizer(root), /incomplete/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('cache scope covers the runtime fixture configuration and Vite absolute-root identity', async () => {
  const config = JSON.parse(await readFile(new URL('../turbo.json', import.meta.url), 'utf8'));
  const task = config.tasks['//#prebundle:e2e-vite'];
  assert.deepEqual(task.outputs, ['node_modules/.vite/deps/**']);
  assert.ok(task.inputs.includes('e2e/support/shared-web-shell-fixture.ts'));
  assert.ok(task.inputs.includes('e2e/fixtures/**'));
  assert.ok(task.dependsOn.includes('//#build:production-bundles'));
  for (const key of ['TERMINAY_E2E_VITE_ROOT', 'TERMINAY_E2E_VITE_RUNTIME', 'NODE_ENV', 'CI']) assert.ok(task.env.includes(key));
  const dockerfile = await readFile(new URL('../Dockerfile.e2e', import.meta.url), 'utf8');
  assert.equal((dockerfile.match(/^RUN /gmu) ?? []).length, 1, 'all application output is committed once');
  assert.ok(dockerfile.indexOf('export TURBO_REMOTE_CACHE_SIGNATURE_KEY') < dockerfile.indexOf('prebundle-e2e-vite-deps.mjs --cached'));
});

test('Turbo restores committed optimizer outputs even though node_modules is ignored', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminay-vite-turbo-restore-'));
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture', workspaces: ['packages/*'], packageManager: 'npm@12.2.1', scripts: { warm: 'node warm.mjs' } }));
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages: { '': { name: 'fixture' } } }));
    await mkdir(join(root, 'packages/child'), { recursive: true });
    await writeFile(join(root, 'packages/child/package.json'), JSON.stringify({ name: 'child', version: '1.0.0' }));
    await writeFile(join(root, '.gitignore'), 'node_modules\n.turbo\n');
    await writeFile(join(root, 'turbo.json'), JSON.stringify({ tasks: { '//#warm': { inputs: ['warm.mjs'], outputs: ['node_modules/.vite/deps/**'] } } }));
    await writeFile(join(root, 'warm.mjs'), `import {mkdirSync,writeFileSync} from 'node:fs'; mkdirSync('node_modules/.vite/deps',{recursive:true});writeFileSync('node_modules/.vite/deps/react.js','committed');\n`);
    const command = fileURLToPath(new URL('../node_modules/turbo/bin/turbo', import.meta.url));
    const args = [command, 'run', 'warm', '--cache=local:rw'];
    // This is a functional restore check, not a startup latency assertion.
    // Allow shared-runner contention while bounding both calls below the
    // enclosing 120-second Node test deadline.
    const options = { cwd: root, encoding: 'utf8', timeout: 30000, env: { ...process.env } };
    execFileSync(process.execPath, args, options);
    await rm(join(root, 'node_modules'), { recursive: true, force: true });
    const restored = execFileSync(process.execPath, args, options);
    assert.match(restored, /1 cached/u);
    assert.equal(await readFile(join(root, 'node_modules/.vite/deps/react.js'), 'utf8'), 'committed');
  } finally { await rm(root, { recursive: true, force: true }); }
});
