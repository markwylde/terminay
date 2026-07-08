import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { build } from 'esbuild'

const execFileAsync = promisify(execFile)

test('default branch quick push skips an already-applied commit and still pushes', async () => {
  const { QuickPushService } = await importBundled('../electron/quickPush/service.ts')
  const root = await mkdtemp(join(tmpdir(), 'terminay-quick-push-default-test-'))
  const remote = join(root, 'remote.git')
  const main = join(root, 'atlas')
  const feature = join(root, 'atlas-machine-browser-fix')

  try {
    await git(['init', '--bare', remote], root)
    await mkdir(main)
    await git(['init', '-b', 'main'], main)
    await git(['config', 'user.email', 'test@example.invalid'], main)
    await git(['config', 'user.name', 'Terminay Test'], main)
    await writeFile(join(main, 'agent.txt'), 'one\n')
    await git(['add', 'agent.txt'], main)
    await git(['commit', '-m', 'initial commit'], main)
    await git(['remote', 'add', 'origin', remote], main)
    await git(['push', '-u', 'origin', 'main'], main)
    await git(['worktree', 'add', feature, '-b', 'fix/machine-browser-session-failures'], main)

    await writeFile(join(feature, 'agent.txt'), 'two\n')

    await writeFile(join(main, 'agent.txt'), 'two\n')
    await git(['add', 'agent.txt'], main)
    await git(['commit', '-m', 'fix: update machine browser session'], main)

    const service = new QuickPushService({ runPrompt: async () => '' })
    const result = await service.apply({
      cwd: feature,
      action: 'default',
      branchName: null,
      pullRequest: null,
      commits: [{ message: 'fix: update machine browser session', files: ['agent.txt'] }],
    })

    assert.equal(result.ok, true, result.error ?? 'quick push should succeed')
    assert.equal(result.pushed, true)
    assert.equal(result.branch, 'main')
    assert.equal(
      result.steps.some((step) => step.ok && step.label === 'Skip commit: fix: update machine browser session'),
      true,
    )

    const localMain = (await git(['rev-parse', 'main'], main)).trim()
    const remoteMain = (await git(['--git-dir', remote, 'rev-parse', 'main'], root)).trim()
    assert.equal(remoteMain, localMain)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function git(args, cwd) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Terminay Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Terminay Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  })
  return stdout
}

async function importBundled(relativePath) {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-quick-push-default-bundle-'))
  const outputPath = join(tempDir, `${relativePath.split('/').pop()}.mjs`)
  try {
    await build({
      entryPoints: [new URL(relativePath, import.meta.url).pathname],
      outfile: outputPath,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node20',
    })
    return await import(outputPath)
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
