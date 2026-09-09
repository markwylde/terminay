import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { assertHostedUiEntry, HOSTED_UI_ENTRY } from './hosted-ui-entry.mjs'

async function directory(files) {
  const root = await mkdtemp(join(tmpdir(), 'terminay-ui-entry-'))
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), contents)
  }
  return root
}

test('the entry is the one the hosted archive loader reads', async () => {
  // If these ever diverge, an artifact passes its build and then cannot serve a
  // workspace — which is the defect this check exists to prevent.
  const loader = await readFile(
    resolve('apps/terminay-server/src/remote/hostedUiArchive.ts'),
    'utf8',
  )
  assert.match(
    loader,
    new RegExp(`entryPath = '${HOSTED_UI_ENTRY}'`, 'u'),
    'the builder and the loader must agree on the hosted entry',
  )
})

test('a UI bundle carrying the entry passes', async () => {
  const root = await directory({ [HOSTED_UI_ENTRY]: '<!doctype html>', 'manifest.json': '{}' })
  try {
    assert.equal(await assertHostedUiEntry(root), join(root, HOSTED_UI_ENTRY))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the Desktop renderer bundle is refused, and the message says which to stage', async () => {
  // `dist` carries remote.html and is the Desktop renderer; staging it is the
  // mistake that shipped, so the failure names both bundles.
  const root = await directory({ 'remote.html': '<!doctype html>', 'manifest.json': '{}' })
  try {
    await assert.rejects(
      () => assertHostedUiEntry(root),
      (error) =>
        error.message.includes(HOSTED_UI_ENTRY) &&
        /dist-web/u.test(error.message) &&
        /dist\)/u.test(error.message),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a directory entry is not a file entry', async () => {
  const root = await directory({})
  await mkdir(join(root, HOSTED_UI_ENTRY), { recursive: true })
  try {
    await assert.rejects(() => assertHostedUiEntry(root), /is missing from/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the builder stages the server-served bundle by default', async () => {
  const builder = await readFile(resolve('scripts/build-standalone-server-artifact.mjs'), 'utf8')
  // A wrong default was inherited silently by a release that passed no
  // override, so the default itself is asserted.
  assert.match(builder, /args\['ui-bundle'\] \?\? 'dist-web'/u)
  assert.match(builder, /assertHostedUiEntry\(uiBundle\)/u)
})

test('the probe refuses an archive whose UI cannot be served', async () => {
  const probe = await readFile(resolve('scripts/probe-standalone-server-archive.mjs'), 'utf8')
  // The builder can be right while a later staging step drops the file, so the
  // probe checks the built archive rather than trusting the build.
  assert.match(probe, /assertHostedUiEntry\(join\(root, 'ui'\)\)/u)
})
