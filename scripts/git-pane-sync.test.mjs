import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'terminay-git-pane-sync-'))
const output = join(directory, 'git-pane-sync.mjs')
await build({
  bundle: true,
  stdin: {
    contents: `
      export { applyGitWorkspaceRefresh } from './src/workspace/useFileExplorerController.ts'
      export { createGitPaneSyncLog, isFreshGitPaneSync } from './src/workspace/gitPaneSyncLog.ts'
    `,
    loader: 'ts',
    resolveDir: process.cwd(),
  },
  format: 'esm',
  logLevel: 'silent',
  outfile: output,
  platform: 'node',
})
const { applyGitWorkspaceRefresh, createGitPaneSyncLog, isFreshGitPaneSync } = await import(
  pathToFileURL(output).href
)

test.after(() => rm(directory, { force: true, recursive: true }))

const PREFIX = '[terminay] git.pane.sync '

function harness({ fail = false, current = true, changed = true } = {}) {
  const state = { fail, current, changed }
  const requests = []
  const lines = []
  const log = createGitPaneSyncLog((line) => lines.push(line))
  const gitClient = {
    async list(request) {
      requests.push(request)
      if (state.fail) throw new Error('git.worktrees.list failed')
      return { defaultBranch: null, repositoryRoot: null, state: 'not-a-repository', worktrees: [] }
    },
  }
  const refresh = (trigger, worktreeId) =>
    applyGitWorkspaceRefresh({
      gitClient,
      project: { id: 'project-a', rootFolder: '/workspace/repo' },
      ...(worktreeId === undefined ? {} : { worktreeId }),
      sync: { trigger, log },
      isCurrent: () => state.current,
      publish: () => state.changed,
      preserveLastProjection: () => undefined,
      onOperationError: () => '',
      onOperationSucceeded: () => undefined,
    })
  const records = () => lines.map((line) => JSON.parse(line.slice(PREFIX.length)))
  return { state, requests, lines, refresh, records }
}

test('only a root change and an explicit refresh ask the server to measure', async () => {
  const { requests, refresh } = harness()
  for (const trigger of ['event', 'resync', 'directory', 'action', 'root', 'refresh'])
    await refresh(trigger, 'worktree-a')

  const asked = Object.fromEntries(
    ['event', 'resync', 'directory', 'action', 'root', 'refresh'].map((trigger, index) => [trigger, requests[index]]),
  )
  for (const trigger of ['event', 'resync', 'directory', 'action']) {
    assert.equal(isFreshGitPaneSync(trigger), false)
    assert.deepEqual(asked[trigger], { projectId: 'project-a', worktreeId: 'worktree-a' }, trigger)
  }
  // A measured listing covers every worktree, so it names none.
  for (const trigger of ['root', 'refresh']) {
    assert.equal(isFreshGitPaneSync(trigger), true)
    assert.deepEqual(asked[trigger], { projectId: 'project-a', fresh: true }, trigger)
  }
})

test('an applied synchronisation is recorded with its trigger, scope, and size', async () => {
  const { lines, refresh, records } = harness()
  await refresh('event', 'worktree-a')
  await refresh('refresh', 'worktree-a')

  assert.equal(lines.length, 2)
  for (const line of lines) assert.equal(line.startsWith(PREFIX), true)
  const [scoped, fresh] = records()
  assert.deepEqual(
    { ...scoped, durationMs: 0 },
    { trigger: 'event', scoped: true, outcome: 'applied', worktrees: 0, durationMs: 0, unchangedSince: 0 },
  )
  assert.equal(typeof scoped.durationMs, 'number')
  assert.equal(fresh.trigger, 'refresh')
  assert.equal(fresh.scoped, false)
})

test('synchronisations that change nothing are silent, and counted onto the next record', async () => {
  const { state, lines, refresh, records } = harness({ changed: false })
  for (let index = 0; index < 10; index += 1) await refresh('event')
  assert.deepEqual(lines, [], 'an idle pane writes nothing')

  state.changed = true
  await refresh('event')
  assert.equal(records()[0].unchangedSince, 10)

  await refresh('event')
  assert.equal(records()[1].unchangedSince, 0)
})

test('superseded and failed synchronisations are recorded as such', async () => {
  const { state, refresh, records } = harness({ current: false })
  await refresh('event')
  state.fail = true
  await refresh('event')
  state.current = true
  await refresh('resync')

  assert.deepEqual(
    records().map(({ trigger, outcome, worktrees }) => ({ trigger, outcome, worktrees })),
    [
      { trigger: 'event', outcome: 'superseded', worktrees: 0 },
      { trigger: 'event', outcome: 'superseded', worktrees: null },
      { trigger: 'resync', outcome: 'failed', worktrees: null },
    ],
  )
})

test('a record carries no project id, path, branch, or worktree id', async () => {
  const { lines, refresh } = harness()
  await refresh('event', 'worktree-a')
  await refresh('root')
  const text = lines.join('\n')
  for (const value of ['project-a', '/workspace', 'worktree-a', 'repo'])
    assert.equal(text.includes(value), false, value)
  assert.deepEqual(
    Object.keys(JSON.parse(lines[0].slice(PREFIX.length))).sort(),
    ['durationMs', 'outcome', 'scoped', 'trigger', 'unchangedSince', 'worktrees'],
  )
})

test('every Git pane refresh names what raised it, and the reload control measures Git', async () => {
  const controller = await readFile('src/workspace/useFileExplorerController.ts', 'utf8')
  const app = await readFile('src/App.tsx', 'utf8')

  for (const trigger of ['directory', 'root', 'event', 'resync'])
    assert.match(
      controller,
      new RegExp(`refreshGitStatusesForRoot\\([^;]*?'${trigger}',?\\s*\\)`, 'u'),
      `no refresh is raised as ${trigger}`,
    )
  assert.match(controller, /trigger: GitPaneSyncTrigger = 'action'/u)
  // The renderer reports through the console main already observes: it has
  // no diagnostics channel of its own.
  assert.doesNotMatch(await readFile('src/workspace/gitPaneSyncLog.ts', 'utf8'), /window\.terminay|ipc/iu)

  const reload = app.match(/onClick=\{\(\) => \{\s*refreshFileExplorerTree\(\);[\s\S]*?\}\}\s*aria-label="Reload explorer"/u)?.[0] ?? ''
  assert.match(reload, /refreshGitStatusesForRoot\([^;]*?'refresh',?\s*\)/u)
  assert.equal(
    [...app.matchAll(/refreshGitStatusesForRoot\([^;]*?'root'\)/gu)].length,
    2,
    'both root-change paths in App raise a measured refresh',
  )
})
