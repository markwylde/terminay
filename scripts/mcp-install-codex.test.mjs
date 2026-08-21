import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const { renderCodexBlock, hasCodexBlock, upsertCodexBlock, removeCodexBlock } =
  await importTransformed('../electron/mcpInstall/tomlEntry.ts')
const { getClaudeCodeConfigPath, isClaudeCodeInstalled, installClaudeCode, uninstallClaudeCode } =
  await importTransformed('../electron/mcpInstall/claudeCode.ts')

const server = {
  command: '/Apps/Terminay',
  args: ['/Apps/dist-electron/serverMcpEntry.js'],
  env: { ELECTRON_RUN_AS_NODE: '1' },
}

test('renderCodexBlock renders command, args, static env, and inherited capability variables', () => {
  const block = renderCodexBlock(server)
  assert.match(block, /^\[mcp_servers\.terminay\]$/m)
  assert.match(block, /command = "\/Apps\/Terminay"/)
  assert.match(block, /args = \["\/Apps\/dist-electron\/serverMcpEntry\.js"\]/)
  assert.match(
    block,
    /env_vars = \["TERMINAY_CONTROL_SOCKET", "TERMINAY_CONTROL_TOKEN"\]/,
  )
  assert.match(block, /env = \{ ELECTRON_RUN_AS_NODE = "1" \}/)
})

test('renderCodexBlock escapes quotes and backslashes', () => {
  const block = renderCodexBlock({ command: 'C:\\a"b', args: [] })
  assert.match(block, /command = "C:\\\\a\\"b"/)
})

test('hasCodexBlock detects presence', () => {
  assert.equal(hasCodexBlock(renderCodexBlock(server)), true)
  assert.equal(hasCodexBlock('[other.table]\nx = 1\n'), false)
})

test('upsertCodexBlock appends to an empty file', () => {
  const out = upsertCodexBlock('', renderCodexBlock(server))
  assert.equal(hasCodexBlock(out), true)
})

test('upsertCodexBlock preserves other tables when appending', () => {
  const existing = '[mcp_servers.other]\ncommand = "x"\n'
  const out = upsertCodexBlock(existing, renderCodexBlock(server))
  assert.match(out, /\[mcp_servers\.other\]/)
  assert.match(out, /\[mcp_servers\.terminay\]/)
})

test('upsertCodexBlock replaces an existing terminay block in place', () => {
  const first = upsertCodexBlock('[a]\nk = 1\n', renderCodexBlock(server))
  const updated = upsertCodexBlock(
    first,
    renderCodexBlock({ ...server, command: '/new/Terminay' }),
  )
  assert.match(updated, /command = "\/new\/Terminay"/)
  assert.doesNotMatch(updated, /\/Apps\/Terminay/)
  // The unrelated table survives and the block is not duplicated.
  assert.match(updated, /\[a\]/)
  assert.equal(updated.match(/\[mcp_servers\.terminay\]/g).length, 1)
})

test('removeCodexBlock removes only the terminay block and is idempotent', () => {
  const withBlock = upsertCodexBlock('[a]\nk = 1\n', renderCodexBlock(server))
  const removed = removeCodexBlock(withBlock)
  assert.equal(hasCodexBlock(removed), false)
  assert.match(removed, /\[a\]/)
  assert.equal(removeCodexBlock(removed), removed)
})

test('Claude Code install round-trips through an isolated temporary home', async () => {
  const home = await mkdtemp(join(tmpdir(), 'terminay-claude-test-'))
  const previousHome = process.env.HOME
  process.env.HOME = home
  const configPath = getClaudeCodeConfigPath()
  const existing = {
    theme: 'dark',
    mcpServers: { other: { command: '/usr/local/bin/other', args: [] } },
  }
  try {
    await writeFile(configPath, `${JSON.stringify(existing)}\n`, 'utf8')
    assert.equal(await isClaudeCodeInstalled(), false)

    const installed = await installClaudeCode(server)
    assert.equal(installed.ok, true)
    assert.equal(installed.installed, true)
    const installedConfig = JSON.parse(await readFile(configPath, 'utf8'))
    assert.deepEqual(installedConfig.mcpServers.other, existing.mcpServers.other)
    assert.deepEqual(installedConfig.mcpServers.terminay, {
      command: server.command,
      args: server.args,
      env: server.env,
    })
    assert.equal(await isClaudeCodeInstalled(), true)

    const uninstalled = await uninstallClaudeCode()
    assert.equal(uninstalled.ok, true)
    assert.equal(uninstalled.installed, false)
    const uninstalledConfig = JSON.parse(await readFile(configPath, 'utf8'))
    assert.deepEqual(uninstalledConfig, existing)
    assert.equal(await isClaudeCodeInstalled(), false)
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = previousHome
    }
    await rm(home, { recursive: true, force: true })
  }
})

async function importTransformed(relativePath) {
  const sourceUrl = new URL(relativePath, import.meta.url)
  const tempDir = await mkdtemp(join(tmpdir(), 'terminay-codex-test-'))
  const outputPath = join(tempDir, `${relativePath.split('/').pop()}.mjs`)
  await build({
    bundle: true,
    entryPoints: [fileURLToPath(sourceUrl)],
    format: 'esm',
    outfile: outputPath,
    platform: 'node',
    target: 'node20',
    write: true,
  })
  return import(outputPath)
}
