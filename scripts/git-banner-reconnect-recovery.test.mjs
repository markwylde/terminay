import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'terminay-git-banner-reconnect-'))
const output = join(directory, 'git-banner.mjs')
await build({
  bundle: true,
  stdin: {
    contents: `
      export { ClientError } from '@terminay/client-core'
      export { applyGitWorkspaceRefresh } from './src/workspace/useFileExplorerController.ts'
      export {
        clearSucceededFeatureFailure,
        describeFeatureFailure,
      } from './src/shared/featureQueryAuthority.ts'
    `,
    loader: 'ts',
    resolveDir: process.cwd(),
  },
  format: 'esm',
  logLevel: 'silent',
  outfile: output,
  platform: 'node',
})
const {
  ClientError,
  applyGitWorkspaceRefresh,
  clearSucceededFeatureFailure,
  describeFeatureFailure,
} = await import(pathToFileURL(output).href)

test.after(() => rm(directory, { force: true, recursive: true }))

/** The workspace banner as App.tsx drives it from the two feature callbacks. */
function createFeatureBanner() {
  const scope = { serverId: 'desktop-1', projectId: 'default' }
  let failure = null
  let visible = null
  return {
    get visible() {
      return visible
    },
    onOperationError(feature, error) {
      const described = describeFeatureFailure(feature, error, scope)
      const message = `${described.title}. ${described.detail}`
      failure = { feature, message }
      visible = message
      return message
    },
    onOperationSucceeded(feature) {
      if (failure === null) return
      const next = clearSucceededFeatureFailure(failure, feature, visible)
      if (next === null) visible = null
      failure = next
    },
  }
}

function createGitClient(state) {
  return {
    async list() {
      if (!state.reachable) {
        throw Object.assign(new Error('git.worktrees.list failed'), {
          operation: 'git.worktrees.list',
          cause: new ClientError('unavailable', 'transport is unavailable'),
        })
      }
      return {
        defaultBranch: null,
        repositoryRoot: null,
        state: 'not-a-repository',
        worktrees: [],
      }
    },
  }
}

test('a Git refresh that succeeds after a transport outage clears the banner', async () => {
  // Suspend, sleep, or a dropped network fails the in-flight worktree list.
  // The reconnect resync refreshes Git again; that success is the only proof
  // the server is reachable, so it must retire the outage notice. Without it
  // the banner survives until an unrelated action happens to reset it.
  const banner = createFeatureBanner()
  const state = { reachable: false }
  const published = []
  const refresh = () =>
    applyGitWorkspaceRefresh({
      gitClient: createGitClient(state),
      project: { id: 'default', rootFolder: '/workspace/repo' },
      isCurrent: () => true,
      publish: (projection) => published.push(projection),
      preserveLastProjection: () => undefined,
      onOperationError: banner.onOperationError,
      onOperationSucceeded: banner.onOperationSucceeded,
    })

  await refresh()
  assert.equal(
    banner.visible,
    'Git is temporarily unavailable. Reconnect to desktop-1 and retry git.worktrees.list.',
  )

  state.reachable = true
  await refresh()

  assert.equal(published.length, 1)
  assert.equal(banner.visible, null)
})

test('a superseded Git refresh neither publishes nor clears the banner', async () => {
  const banner = createFeatureBanner()
  const state = { reachable: false }
  const published = []
  await applyGitWorkspaceRefresh({
    gitClient: createGitClient(state),
    project: { id: 'default', rootFolder: '/workspace/repo' },
    isCurrent: () => true,
    publish: (projection) => published.push(projection),
    preserveLastProjection: () => undefined,
    onOperationError: banner.onOperationError,
    onOperationSucceeded: banner.onOperationSucceeded,
  })
  const outageMessage = banner.visible
  assert.match(outageMessage ?? '', /temporarily unavailable/u)

  state.reachable = true
  await applyGitWorkspaceRefresh({
    gitClient: createGitClient(state),
    project: { id: 'default', rootFolder: '/workspace/repo' },
    isCurrent: () => false,
    publish: (projection) => published.push(projection),
    preserveLastProjection: () => undefined,
    onOperationError: banner.onOperationError,
    onOperationSucceeded: banner.onOperationSucceeded,
  })

  assert.equal(published.length, 0)
  assert.equal(banner.visible, outageMessage)
})

test('a Git failure does not retire an Explorer notice', () => {
  const banner = createFeatureBanner()
  banner.onOperationError('Explorer', new Error('read failed'))
  const explorerMessage = banner.visible
  banner.onOperationSucceeded('Git')
  assert.equal(banner.visible, explorerMessage)
})
