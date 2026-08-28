import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()

test('repository ownership decision is backed by the matched release topology', async () => {
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const decision = await readFile(join(root, 'specs/decisions/evidence/repository-ownership-release.md'), 'utf8')
  const runtime = await readFile(join(root, 'specs/features/server-runtime-and-protocol.md'), 'utf8')
  const ci = await readFile(join(root, '.github/workflows/ci.yml'), 'utf8')
  const release = await readFile(join(root, '.github/workflows/trigger-release.yml'), 'utf8')

  assert.deepEqual(packageJson.workspaces, ['apps/*', 'packages/*', 'extensions/*'])
  assert.match(decision, /Keep Terminay Desktop, the embedded\/standalone Terminay Server/u)
  assert.match(decision, /hosted bootstrap\/signaling service remains an independently owned\s+repository/u)
  assert.match(runtime, /server-bundled workspace UI/u)
  assert.match(runtime, /same source as the desktop experience/u)
  assert.match(ci, /npm run test:ci/u)
  assert.match(ci, /npm run test:e2e -- --shard=\$\{\{ matrix\.shard \}\}\/10/u)
  assert.match(release, /Sync package version to release tag/u)
  assert.match(release, / {2}build-binaries:/u)
  assert.match(release, / {2}build-standalone-server:/u)
  assert.match(release, /EXPECTED_COMMIT: \$\{\{ needs\.release\.outputs\.source_commit \}\}/u)
  assert.match(
    release,
    /node scripts\/stage-selected-secure-werift-runtime\.mjs[\s\S]{0,120}\$\{\{ matrix\.script \}\}/u,
  )
})
