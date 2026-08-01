import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

const { ServerTerminalAuthority, TerminalService } = await importAuthority()

test('embedded composed authority reconciles managed Codex and Claude hooks', async () => {
  const profileRoot = await mkdtemp(join(tmpdir(), 'terminay-task9-embedded-hooks-'))
  const hookOptions = { homeDir: profileRoot, scriptDir: join(profileRoot, 'managed-hooks') }
  const authority = new ServerTerminalAuthority({
    serverId: 'embedded-provider-reconciliation',
    terminalService: new TerminalService({
      serverId: 'embedded-provider-reconciliation',
      ptyFactory: { spawn: () => { throw new Error('this reconciliation fixture never creates a terminal') } },
    }),
  })

  try {
    await mkdir(join(profileRoot, '.codex'), { recursive: true })
    await mkdir(join(profileRoot, '.claude'), { recursive: true })
    await writeFile(join(profileRoot, '.codex', 'hooks.json'), JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'Write', hooks: [{ type: 'command', command: 'TERMINAY_MANAGED_AGENT_HOOK=1 /bin/sh /stale codex' }] },
          { matcher: 'Write', hooks: [{ type: 'command', command: 'user-write-hook' }] },
        ],
      },
    }))
    await writeFile(join(profileRoot, '.claude', 'settings.json'), JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'user-stop-hook' }] }] },
    }))

    await authority.composition.start()
    assert.equal(authority.agents.listening, true)

    const installed = await authority.agents.drivers.reconcileHooks({ action: 'install', options: hookOptions })
    assert.equal(installed.ok, true)
    assert.deepEqual(installed.statuses.map(({ provider, state }) => ({ provider, state })), [
      { provider: 'codex', state: 'installed' },
      { provider: 'claude-code', state: 'installed' },
    ])

    const codex = JSON.parse(await readFile(join(profileRoot, '.codex', 'hooks.json'), 'utf8'))
    const codexManaged = codex.hooks.PreToolUse
      .flatMap((definition) => (definition.hooks ?? []).map((hook) => ({ definition, hook })))
      .filter(({ hook }) => hook.command.includes('TERMINAY_MANAGED_AGENT_HOOK=1'))
    assert.equal(codexManaged.length, 1)
    assert.equal(codexManaged[0].definition.matcher, '*')
    assert.equal(codex.hooks.PreToolUse.some((definition) => definition.matcher === 'Write' && definition.hooks.some((hook) => hook.command === 'user-write-hook')), true)

    authority.agents.setIntegrationEnabled(false)
    const removed = await authority.agents.drivers.reconcileHooks({ action: 'uninstall', options: hookOptions })
    assert.equal(removed.ok, true)
    assert.deepEqual(removed.statuses.map(({ provider, state }) => ({ provider, state })), [
      { provider: 'codex', state: 'not-installed' },
      { provider: 'claude-code', state: 'not-installed' },
    ])
    const claude = JSON.parse(await readFile(join(profileRoot, '.claude', 'settings.json'), 'utf8'))
    assert.equal(claude.hooks.Stop[0].hooks[0].command, 'user-stop-hook')
  } finally {
    await authority.shutdown()
    await rm(profileRoot, { recursive: true, force: true })
  }
})

async function importAuthority() {
  const directory = await mkdtemp(join(tmpdir(), 'terminay-task9-embedded-authority-'))
  const outputPath = join(directory, 'authority.mjs')
  try {
    await build({
      bundle: true,
      format: 'esm',
      outfile: outputPath,
      platform: 'node',
      stdin: {
        contents: [
          `export { ServerTerminalAuthority } from ${JSON.stringify(new URL('../electron/serverTerminalAuthority.ts', import.meta.url).pathname)}`,
          `export { TerminalService } from ${JSON.stringify(new URL('../packages/server-core/src/terminalService/service.ts', import.meta.url).pathname)}`,
        ].join('\n'),
        loader: 'ts',
        resolveDir: process.cwd(),
      },
      target: 'node22',
    })
    return await import(outputPath)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
