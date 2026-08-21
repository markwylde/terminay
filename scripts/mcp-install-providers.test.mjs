import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { build } from 'esbuild'

const testHome = await mkdtemp(join(tmpdir(), 'terminay-mcp-install-home-'))
const installOptions = { homeDirectory: testHome }

const {
  MCP_INSTALL_PROVIDERS,
  getMcpInstallStatus,
  installMcpAgent,
  uninstallMcpAgent,
} = await importBundled('../electron/mcpInstall/index.ts')

const server = {
  command: '/Applications/Terminay.app/Contents/MacOS/Terminay',
  args: ['/Applications/Terminay.app/Contents/Resources/app.asar.unpacked/dist-electron/serverMcpEntry.js'],
  env: { ELECTRON_RUN_AS_NODE: '1' },
}

after(async () => {
  await rm(testHome, { recursive: true, force: true })
})

test('Claude Code install preserves unrelated configuration and uninstall removes only Terminay', async () => {
  const configPath = join(testHome, '.claude.json')
  await writeFile(
    configPath,
    `${JSON.stringify({
      theme: 'dark',
      mcpServers: {
        existing: {
          command: '/usr/bin/existing-mcp',
          args: ['--safe'],
          env: { EXISTING_SETTING: 'kept' },
        },
      },
    }, null, 2)}\n`,
  )

  const installed = await installMcpAgent('claudeCode', server, installOptions)
  assert.deepEqual(installed, {
    ok: true,
    installed: true,
    message: `Registered terminay in ${configPath}`,
  })

  const config = JSON.parse(await readFile(configPath, 'utf8'))
  assert.equal(config.theme, 'dark')
  assert.deepEqual(config.mcpServers.existing, {
    command: '/usr/bin/existing-mcp',
    args: ['--safe'],
    env: { EXISTING_SETTING: 'kept' },
  })
  assert.deepEqual(config.mcpServers.terminay, server)

  const status = await getMcpInstallStatus(server, installOptions)
  assert.equal(status.agents.find((agent) => agent.id === 'claudeCode')?.installed, true)

  const uninstalled = await uninstallMcpAgent('claudeCode', server, installOptions)
  assert.deepEqual(uninstalled, {
    ok: true,
    installed: false,
    message: `Removed terminay from ${configPath}`,
  })

  const afterUninstall = JSON.parse(await readFile(configPath, 'utf8'))
  assert.equal(afterUninstall.theme, 'dark')
  assert.deepEqual(afterUninstall.mcpServers.existing, config.mcpServers.existing)
  assert.equal('terminay' in afterUninstall.mcpServers, false)
})

test('Codex and Claude Code registrations launch the same MCP command contract', async () => {
  await mkdir(join(testHome, '.codex'), { recursive: true })
  await writeFile(
    join(testHome, '.codex', 'config.toml'),
    '[mcp_servers.existing]\ncommand = "/usr/bin/existing-mcp"\n',
  )

  assert.equal((await installMcpAgent('codex', server, installOptions)).ok, true)
  assert.equal((await installMcpAgent('claudeCode', server, installOptions)).ok, true)

  const codexConfig = await readFile(join(testHome, '.codex', 'config.toml'), 'utf8')
  assert.match(codexConfig, /\[mcp_servers\.existing\]/)
  assert.match(codexConfig, /\[mcp_servers\.terminay\]/)
  assert.match(codexConfig, new RegExp(`command = ${escapeRegex(JSON.stringify(server.command))}`))
  assert.match(codexConfig, new RegExp(`args = \\[${escapeRegex(JSON.stringify(server.args[0]))}\\]`))
  assert.match(codexConfig, /env = \{ ELECTRON_RUN_AS_NODE = "1" \}/)

  const claudeConfig = JSON.parse(await readFile(join(testHome, '.claude.json'), 'utf8'))
  assert.deepEqual(claudeConfig.mcpServers.terminay, server)

  const status = await getMcpInstallStatus(server, installOptions)
  assert.deepEqual(
    status.agents.map(({ id, installed }) => ({ id, installed })),
    [
      { id: 'claudeCode', installed: true },
      { id: 'codex', installed: true },
      { id: 'cursor', installed: false },
      { id: 'gemini', installed: false },
      { id: 'openCode', installed: false },
    ],
  )

  assert.equal((await uninstallMcpAgent('codex', server, installOptions)).ok, true)
  const codexAfterUninstall = await readFile(join(testHome, '.codex', 'config.toml'), 'utf8')
  assert.match(codexAfterUninstall, /\[mcp_servers\.existing\]/)
  assert.doesNotMatch(codexAfterUninstall, /\[mcp_servers\.terminay\]/)
})

test('Claude Code refuses to overwrite malformed JSON', async () => {
  const configPath = join(testHome, '.claude.json')
  await writeFile(configPath, '{ malformed')

  const result = await installMcpAgent('claudeCode', server, installOptions)
  assert.equal(result.ok, false)
  assert.equal(result.installed, false)
  assert.match(result.error, /Could not parse .*\.claude\.json as JSON/)
  assert.equal(await readFile(configPath, 'utf8'), '{ malformed')
})

test('provider installs preserve config modes and identical entries are idempotent', async () => {
  const home = await mkdtemp(join(tmpdir(), 'terminay-mcp-install-modes-'))
  const options = { homeDirectory: home }
  const claudePath = join(home, '.claude.json')
  const codexPath = join(home, '.codex', 'config.toml')
  await mkdir(join(home, '.codex'), { recursive: true })
  await writeFile(claudePath, '{"theme":"dim"}\n')
  await writeFile(codexPath, 'model = "gpt-test"\n')
  await chmod(claudePath, 0o640)
  await chmod(codexPath, 0o604)

  assert.equal((await installMcpAgent('claudeCode', server, options)).ok, true)
  assert.equal((await installMcpAgent('codex', server, options)).ok, true)
  assert.equal((await stat(claudePath)).mode & 0o777, 0o640)
  assert.equal((await stat(codexPath)).mode & 0o777, 0o604)

  const claudeInstalled = await readFile(claudePath, 'utf8')
  const codexInstalled = await readFile(codexPath, 'utf8')
  assert.equal((await installMcpAgent('claudeCode', server, options)).ok, true)
  assert.equal((await installMcpAgent('codex', server, options)).ok, true)
  assert.equal(await readFile(claudePath, 'utf8'), claudeInstalled)
  assert.equal(await readFile(codexPath, 'utf8'), codexInstalled)

  assert.equal((await uninstallMcpAgent('claudeCode', server, options)).ok, true)
  assert.equal((await uninstallMcpAgent('codex', server, options)).ok, true)
  assert.equal((await stat(claudePath)).mode & 0o777, 0o640)
  assert.equal((await stat(codexPath)).mode & 0o777, 0o604)
  assert.equal(JSON.parse(await readFile(claudePath, 'utf8')).theme, 'dim')
  assert.match(await readFile(codexPath, 'utf8'), /model = "gpt-test"/)

  await rm(home, { recursive: true, force: true })
})

test('provider installs refuse to replace user-modified Terminay entries', async () => {
  const home = await mkdtemp(join(tmpdir(), 'terminay-mcp-install-changed-'))
  const options = { homeDirectory: home }
  const claudePath = join(home, '.claude.json')
  const codexPath = join(home, '.codex', 'config.toml')
  await mkdir(join(home, '.codex'), { recursive: true })

  const claudeContent = `${JSON.stringify({
    theme: 'kept',
    mcpServers: {
      terminay: { command: '/user/changed-command', args: ['--custom'] },
    },
  }, null, 2)}\n`
  const codexContent =
    'model = "kept"\n\n[mcp_servers.terminay]\ncommand = "/user/changed-command"\nargs = ["--custom"]\n'
  await writeFile(claudePath, claudeContent)
  await writeFile(codexPath, codexContent)

  for (const [agent, path, original] of [
    ['claudeCode', claudePath, claudeContent],
    ['codex', codexPath, codexContent],
  ]) {
    const result = await installMcpAgent(agent, server, options)
    assert.equal(result.ok, false)
    assert.equal(result.installed, true)
    assert.match(result.error, /has changed; review it before replacing it/)
    assert.equal(await readFile(path, 'utf8'), original)
  }

  const status = await getMcpInstallStatus(server, options)
  assert.deepEqual(
    status.agents.map(({ id, state }) => ({ id, state })),
    [
      { id: 'claudeCode', state: 'changed' },
      { id: 'codex', state: 'changed' },
      { id: 'cursor', state: 'not-installed' },
      { id: 'gemini', state: 'not-installed' },
      { id: 'openCode', state: 'not-installed' },
    ],
  )
  for (const [agent, path, original] of [
    ['claudeCode', claudePath, claudeContent],
    ['codex', codexPath, codexContent],
  ]) {
    const result = await uninstallMcpAgent(agent, server, options)
    assert.equal(result.ok, false)
    assert.equal(result.installed, true)
    assert.match(result.error, /has changed; review it before replacing it/)
    assert.equal(await readFile(path, 'utf8'), original)
  }

  await rm(home, { recursive: true, force: true })
})

test('provider registry detects and routes all supported registrations independently', async () => {
  const home = await mkdtemp(join(tmpdir(), 'terminay-mcp-install-registry-'))
  const options = { homeDirectory: home }
  const agentIds = ['claudeCode', 'codex', 'cursor', 'gemini', 'openCode']

  assert.deepEqual(MCP_INSTALL_PROVIDERS.map(({ id }) => id), agentIds)
  assert.deepEqual(
    (await getMcpInstallStatus(server, options)).agents.map(({ id, state }) => ({ id, state })),
    agentIds.map((id) => ({ id, state: 'not-installed' })),
  )

  for (const agent of agentIds) {
    const result = await installMcpAgent(agent, server, options)
    assert.equal(result.ok, true, agent)
    assert.equal(result.installed, true, agent)
  }

  assert.deepEqual(
    (await getMcpInstallStatus(server, options)).agents.map(({ id, state, installed }) => ({ id, state, installed })),
    agentIds.map((id) => ({ id, state: 'installed', installed: true })),
  )

  for (const agent of agentIds) {
    const result = await uninstallMcpAgent(agent, server, options)
    assert.equal(result.ok, true, agent)
    assert.equal(result.installed, false, agent)
  }

  assert.deepEqual(
    (await getMcpInstallStatus(server, options)).agents.map(({ id, state, installed }) => ({ id, state, installed })),
    agentIds.map((id) => ({ id, state: 'not-installed', installed: false })),
  )
  await rm(home, { recursive: true, force: true })
})

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function importBundled(relativePath) {
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-mcp-install-bundle-'))
  const outputPath = join(tempDir, `${relativePath.split('/').pop()}.mjs`)
  await build({
    bundle: true,
    entryPoints: [new URL(relativePath, import.meta.url).pathname],
    format: 'esm',
    outfile: outputPath,
    platform: 'node',
    target: 'node20',
  })
  return import(outputPath)
}
