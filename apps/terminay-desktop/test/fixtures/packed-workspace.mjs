import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const archives = new Map();
let temporary;

// Each test worker packs immutable build output once. Every case still gets
// its own extraction, so tampering in one case cannot affect another.
after(async () => {
  if (temporary) await rm(await temporary, { recursive: true, force: true });
});

export async function packAndExtract(workspace, destination) {
  if (!archives.has(workspace)) {
    temporary ??= mkdtemp(join(tmpdir(), 'terminay-test-archives-'));
    archives.set(workspace, (async () => {
      const directory = await temporary;
      const { stdout } = await run('npm', ['pack', '--workspace', workspace, '--json', '--pack-destination', directory], {
        cwd: repositoryRoot,
        timeout: 60000,
        maxBuffer: 4 * 1024 * 1024,
      });
      const value = JSON.parse(stdout);
      const packed = Array.isArray(value) ? value : Object.values(value ?? {});
      assert.equal(packed.length, 1);
      return join(directory, packed[0].filename);
    })());
  }
  const archive = await archives.get(workspace);
  const extracted = join(destination, 'extracted');
  await mkdir(extracted, { recursive: true });
  await run('tar', ['-xzf', archive, '-C', extracted], { timeout: 60000 });
  return join(extracted, 'package');
}
