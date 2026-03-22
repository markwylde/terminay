import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { analyzeCommits } from '@semantic-release/commit-analyzer'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseConfig = JSON.parse(
  await readFile(resolve(rootDir, '.releaserc.json'), 'utf8'),
)
const commitAnalyzerConfig = releaseConfig.plugins.find(
  (plugin) =>
    Array.isArray(plugin) && plugin[0] === '@semantic-release/commit-analyzer',
)?.[1]

if (!commitAnalyzerConfig) {
  throw new Error(
    'Unable to load @semantic-release/commit-analyzer config from .releaserc.json',
  )
}

function analyze(messages) {
  return analyzeCommits(commitAnalyzerConfig, {
    cwd: rootDir,
    commits: messages.map((message, index) => ({
      hash: `commit-${index + 1}`,
      message,
    })),
    logger: {
      log() {},
    },
  })
}

test('returns no release when there are zero commits', async () => {
  assert.equal(await analyze([]), null)
})

test('treats chore commits as patch releases', async () => {
  assert.equal(await analyze(['chore: refresh packaging metadata']), 'patch')
})

test('treats ignored non-conventional commit subjects as patch releases', async () => {
  assert.equal(await analyze(['Polish terminal workspace layout']), 'patch')
})

test('keeps feature commits as minor releases', async () => {
  assert.equal(await analyze(['feat: add popout terminal groups']), 'minor')
})

test('keeps breaking changes as major releases', async () => {
  assert.equal(
    await analyze([
      'feat!: change session API\n\nBREAKING CHANGE: preload terminal session contracts now require explicit options',
    ]),
    'major',
  )
})
