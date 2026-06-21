import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { transform } from 'esbuild'

const { isGithubRemote, parseRemoteWebInfo } = await importTransformed('../electron/quickPush/pullRequest.ts')

test('parseRemoteWebInfo parses GitHub HTTPS remotes', () => {
  assert.deepEqual(parseRemoteWebInfo('https://github.com/markwylde/terminay.git'), {
    host: 'github.com',
    owner: 'markwylde',
    repo: 'terminay',
    webUrl: 'https://github.com/markwylde/terminay',
  })
  assert.equal(isGithubRemote('https://github.com/markwylde/terminay.git'), true)
})

test('parseRemoteWebInfo parses SSH scp-style remotes', () => {
  assert.deepEqual(parseRemoteWebInfo('git@git.i.wylde.net:puzed/vms.git'), {
    host: 'git.i.wylde.net',
    owner: 'puzed',
    repo: 'vms',
    webUrl: 'https://git.i.wylde.net/puzed/vms',
  })
  assert.equal(isGithubRemote('git@git.i.wylde.net:puzed/vms.git'), false)
})

test('parseRemoteWebInfo parses ssh URL remotes', () => {
  assert.deepEqual(parseRemoteWebInfo('ssh://git@gitea.example.test/acme/api.git'), {
    host: 'gitea.example.test',
    owner: 'acme',
    repo: 'api',
    webUrl: 'https://gitea.example.test/acme/api',
  })
})

test('parseRemoteWebInfo leaves non-web local paths without a web URL', () => {
  assert.deepEqual(parseRemoteWebInfo('/Users/mark/src/repo.git'), {
    host: null,
    owner: null,
    repo: null,
    webUrl: null,
  })
})

async function importTransformed(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
  const transformed = await transform(source, {
    format: 'esm',
    loader: 'ts',
    platform: 'node',
    target: 'node20',
  })
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-quick-push-pr-test-'))
  const outputPath = join(tempDir, `${relativePath.split('/').pop()}.mjs`)
  await writeFile(outputPath, transformed.code)
  return import(outputPath)
}
