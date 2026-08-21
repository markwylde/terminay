import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

const [cursor, gemini] = await Promise.all([
  importBundled('../electron/mcpInstall/cursor.ts'),
  importBundled('../electron/mcpInstall/gemini.ts'),
])

const server = {
  command: '/Applications/Terminay.app/Contents/MacOS/Terminay',
  args: ['/Applications/Terminay.app/Contents/Resources/app.asar.unpacked/dist-electron/serverMcpEntry.js'],
  env: { ELECTRON_RUN_AS_NODE: '1' },
}

const providers = [
  {
    name: 'Cursor CLI',
    adapter: cursor,
    directory: '.cursor',
    filename: 'mcp.json',
    configPath: cursor.getCursorConfigPath,
    inspect: cursor.inspectCursorRegistration,
    install: cursor.installCursor,
    uninstall: cursor.uninstallCursor,
    isInstalled: cursor.isCursorInstalled,
    unrelated: { theme: 'dark', mcpServers: { existing: { command: '/usr/bin/existing', args: ['--kept'] } } },
  },
  {
    name: 'Gemini CLI',
    adapter: gemini,
    directory: '.gemini',
    filename: 'settings.json',
    configPath: gemini.getGeminiConfigPath,
    inspect: gemini.inspectGeminiRegistration,
    install: gemini.installGemini,
    uninstall: gemini.uninstallGemini,
    isInstalled: gemini.isGeminiInstalled,
    unrelated: {
      general: { defaultApprovalMode: 'default' },
      mcp: { allowed: ['existing'], excluded: ['experimental'] },
      mcpServers: { existing: { command: '/usr/bin/existing', args: ['--kept'] } },
    },
  },
]

for (const provider of providers) {
  test(`${provider.name} creates an absent user-level entry and preserves unrelated configuration`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'terminay-mcp-provider-'))
    const path = provider.configPath(home)
    try {
      assert.deepEqual(await provider.inspect(server, home), { state: 'not-installed' })
      assert.equal(await provider.isInstalled(home), false)

      const installed = await provider.install(server, home)
      assert.deepEqual(installed, { ok: true, installed: true, message: `Registered terminay in ${path}` })
      const created = JSON.parse(await readFile(path, 'utf8'))
      assert.deepEqual(created, { mcpServers: { terminay: server } })
      assert.equal('trust' in created.mcpServers.terminay, false)
      assert.deepEqual(await provider.inspect(server, home), { state: 'installed' })
      assert.equal(await provider.isInstalled(home), true)

      await writeFile(path, `${JSON.stringify(provider.unrelated, null, 2)}\n`)
      const preserved = await provider.install(server, home)
      assert.equal(preserved.ok, true)
      const configured = JSON.parse(await readFile(path, 'utf8'))
      assert.deepEqual(configured.mcpServers.existing, provider.unrelated.mcpServers.existing)
      assert.deepEqual(configured.mcpServers.terminay, server)
      for (const [key, value] of Object.entries(provider.unrelated)) {
        if (key !== 'mcpServers') assert.deepEqual(configured[key], value)
      }
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  test(`${provider.name} exact entries are idempotent and uninstall removes only Terminay`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'terminay-mcp-provider-'))
    const path = provider.configPath(home)
    try {
      await mkdir(join(home, provider.directory), { recursive: true })
      await writeFile(path, `${JSON.stringify({ ...provider.unrelated, mcpServers: { ...provider.unrelated.mcpServers, terminay: server } }, null, 2)}\n`)

      const before = await readFile(path, 'utf8')
      assert.deepEqual(await provider.install(server, home), {
        ok: true,
        installed: true,
        message: `terminay is already registered in ${path}`,
      })
      assert.equal(await readFile(path, 'utf8'), before)

      assert.deepEqual(await provider.uninstall(server, home), {
        ok: true,
        installed: false,
        message: `Removed terminay from ${path}`,
      })
      const removed = JSON.parse(await readFile(path, 'utf8'))
      assert.deepEqual(removed, provider.unrelated)
      assert.deepEqual(await provider.uninstall(server, home), {
        ok: true,
        installed: false,
        message: 'terminay was not registered',
      })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  test(`${provider.name} marks changed entries for review and never mutates them`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'terminay-mcp-provider-'))
    const path = provider.configPath(home)
    const changed = {
      ...provider.unrelated,
      mcpServers: { ...provider.unrelated.mcpServers, terminay: { command: '/user/changed-command', args: ['--custom'] } },
    }
    try {
      await mkdir(join(home, provider.directory), { recursive: true })
      const original = `${JSON.stringify(changed, null, 2)}\n`
      await writeFile(path, original)

      assert.deepEqual(await provider.inspect(server, home), {
        state: 'changed',
        message: 'The existing Terminay MCP entry differs from this version of Terminay.',
      })
      for (const action of [provider.install, provider.uninstall]) {
        const result = await action(server, home)
        assert.equal(result.ok, false)
        assert.equal(result.installed, true)
        assert.match(result.error, /has changed; review it before replacing it/)
        assert.equal(await readFile(path, 'utf8'), original)
      }
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  test(`${provider.name} reports malformed or unsupported configuration as unavailable without rewriting it`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'terminay-mcp-provider-'))
    const path = provider.configPath(home)
    try {
      await mkdir(join(home, provider.directory), { recursive: true })
      for (const original of ['{ malformed', '{"mcpServers":[]}']) {
        await writeFile(path, original)
        const status = await provider.inspect(server, home)
        assert.equal(status.state, 'unavailable')
        assert.equal(await provider.isInstalled(home), false)
        const install = await provider.install(server, home)
        assert.equal(install.ok, false)
        assert.equal(install.installed, false)
        const uninstall = await provider.uninstall(server, home)
        assert.equal(uninstall.ok, false)
        assert.equal(uninstall.installed, false)
        assert.equal(await readFile(path, 'utf8'), original)
      }
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
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
