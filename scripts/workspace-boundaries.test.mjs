import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkWorkspace } from './check-workspace-boundaries.mjs';

async function fixture(packages) {
  const root = await mkdtemp(join(tmpdir(), 'terminay-boundaries-'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, workspaces: ['apps/*', 'packages/*'] }));
  for (const entry of packages) {
    const directory = join(root, entry.kind === 'app' ? 'apps' : 'packages', entry.directory);
    await mkdir(join(directory, 'src'), { recursive: true });
    await writeFile(join(directory, 'package.json'), JSON.stringify({
      name: entry.name,
      private: true,
      type: 'module',
      exports: { '.': './dist/index.js' },
      ...(entry.dependencies ? { dependencies: entry.dependencies } : {}),
    }));
    for (const [path, contents] of Object.entries(entry.files ?? {})) {
      const target = join(directory, path);
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, contents);
    }
  }
  return root;
}

async function withFixture(packages, callback) {
  const root = await fixture(packages);
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('the checked-in workspace has no boundary violations', () => {
  const result = checkWorkspace(process.cwd());
  assert.deepEqual(result.violations, []);
});

test('checks static, export, dynamic-import, and require syntax forms', async () => {
  await withFixture([{ kind: 'app', directory: 'a', name: '@fixture/a', files: {
    'src/index.ts': "import 'undeclared-static'; export * from 'undeclared-export'; const d = import('undeclared-dynamic'); const r = require('undeclared-require'); void [d, r];",
  } }], async (root) => {
    const messages = checkWorkspace(root).violations.map((item) => item.message).join('\n');
    assert.match(messages, /undeclared-static/);
    assert.match(messages, /undeclared-export/);
    assert.match(messages, /undeclared-dynamic/);
    assert.match(messages, /undeclared-require/);
  });
});

test('rejects platform imports from browser-safe shared packages', async () => {
  await withFixture([
    { kind: 'package', directory: 'protocol', name: '@terminay/protocol', files: { 'src/index.ts': "import fs from 'node:fs'; import WebSocket from 'ws'; void [fs, WebSocket];" } },
    { kind: 'package', directory: 'server-core', name: '@terminay/server-core', files: { 'src/index.ts': "import electron from 'electron'; void electron;" } },
  ], async (root) => {
    const messages = checkWorkspace(root).violations.map((item) => item.message).join('\n');
    assert.match(messages, /shared package cannot import platform/);
    assert.match(messages, /server-core cannot import Electron/);
  });
});

test('rejects cross-application, deep, renderer-host, and quarantine bypasses', async () => {
  await withFixture([
    { kind: 'app', directory: 'a', name: '@fixture/a', files: { 'src/index.ts': "import '@fixture/b';" } },
    { kind: 'app', directory: 'b', name: '@fixture/b', files: { 'src/index.ts': '' } },
    { kind: 'package', directory: 'protocol', name: '@terminay/protocol', files: { 'src/index.ts': "import '@terminay/protocol/src/types.js';" } },
    { kind: 'app', directory: 'terminay-desktop', name: '@terminay/desktop', files: {
      'src/renderer/index.ts': "import '../main/index.js'; import '../legacy-services/service.js';",
      'src/main/index.ts': '',
      'src/legacy-services/service.js': '',
    } },
  ], async (root) => {
    const messages = checkWorkspace(root).violations.map((item) => item.message).join('\n');
    assert.match(messages, /application packages cannot depend on one another/);
    assert.match(messages, /package-internal or generated-output deep import/);
    assert.match(messages, /Desktop renderer cannot import main or preload/);
    assert.match(messages, /legacy services may only be reached/);
  });
});

test('allows only Desktop main to compose the exact packaged Server application', async () => {
  await withFixture([
    {
      kind: 'app',
      directory: 'terminay-desktop',
      name: '@terminay/desktop',
      dependencies: { '@terminay/server': '1.0.0' },
      files: {
        'src/main/embeddedRuntime.ts': "import '@terminay/server';",
        'src/preload/index.ts': "import '@terminay/server';",
        'src/renderer/index.ts': "import '@terminay/server';",
      },
    },
    { kind: 'app', directory: 'terminay-server', name: '@terminay/server', files: { 'src/index.ts': '' } },
  ], async (root) => {
    const result = checkWorkspace(root);
    assert.equal(
      result.violations.some((item) => item.file.endsWith('/src/main/embeddedRuntime.ts')),
      false,
    );
    assert.deepEqual(
      result.violations
        .filter((item) => /application packages cannot depend on one another/.test(item.message))
        .map((item) => item.file.replace(root, ''))
        .sort(),
      [
        '/apps/terminay-desktop/src/preload/index.ts',
        '/apps/terminay-desktop/src/renderer/index.ts',
      ],
    );
  });
});
