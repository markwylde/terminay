import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const repositoryRoot = resolve(new URL('..', import.meta.url).pathname)

test('compiled development server-core executes provider discovery and managed hooks without Desktop paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'terminay-task6-development-runtime-'))
  try {
    // This is intentionally the normal compiled workspace layout, rather than
    // an npm-pack extract. It proves development does not need Electron's
    // former agent-driver paths to execute these server-owned capabilities.
    const serverCore = await import(
      pathToFileURL(join(repositoryRoot, 'packages/server-core/dist/index.js')).href,
    )

    const providers = serverCore.createServerAiProviderAdapters({
      cwd: repositoryRoot,
      environment: { PATH: process.env.PATH ?? '' },
      commands: {
        codex: {
          command: process.execPath,
          listArgs: () => ['-e', "process.stdout.write('development-provider-cli')"],
          parseModels: (stdout) => [
            { id: stdout.trim(), label: 'Development provider CLI' },
          ],
        },
      },
    })
    assert.deepEqual(
      await providers.codex.listModels({
        provider: 'codex',
        signal: new AbortController().signal,
        maxOutputBytes: 1024,
      }),
      [{ id: 'development-provider-cli', label: 'Development provider CLI' }],
    )

    const homeDir = join(root, 'home')
    const hooks = serverCore.createAgentDriverRegistry()
    const result = await hooks.reconcileHooks({
      action: 'install',
      options: { homeDir },
    })
    assert.equal(result.ok, true)
    assert.deepEqual(
      result.statuses.map((status) => status.provider).sort(),
      ['claude-code', 'codex'],
    )

    const hooksDirectory = join(homeDir, '.terminay', 'agent-hooks')
    const [codexConfig, claudeConfig, codexScript, claudeScript] = await Promise.all([
      readFile(join(homeDir, '.codex', 'hooks.json'), 'utf8'),
      readFile(join(homeDir, '.claude', 'settings.json'), 'utf8'),
      stat(join(hooksDirectory, 'terminay-codex-agent-hook.sh')),
      stat(join(hooksDirectory, 'terminay-claude-code-agent-hook.sh')),
    ])
    for (const config of [codexConfig, claudeConfig]) {
      assert.match(config, /TERMINAY_MANAGED_AGENT_HOOK=1/u)
      assert.doesNotMatch(config, /TERMINAY_AGENT_HOOK_(?:ENDPOINT|TOKEN)/u)
    }
    assert.equal(codexScript.mode & 0o777, 0o700)
    assert.equal(claudeScript.mode & 0o777, 0o700)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
