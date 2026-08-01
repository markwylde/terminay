import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('MCP installation uses the bounded Desktop host bridge', async () => {
  const [modal, preload, main, declarations, types] = await Promise.all([
    readFile(new URL('src/components/McpInstallModal.tsx', root), 'utf8'),
    readFile(new URL('electron/preload.ts', root), 'utf8'),
    readFile(new URL('electron/main.ts', root), 'utf8'),
    readFile(new URL('src/vite-env.d.ts', root), 'utf8'),
    readFile(new URL('src/types/terminay.ts', root), 'utf8'),
  ])

  assert.match(modal, /requireMcpInstallHost\(\)\.getStatus\(\)/u)
  assert.match(modal, /requireMcpInstallHost\(\)\.install\(agent\)/u)
  assert.match(modal, /requireMcpInstallHost\(\)\.uninstall\(agent\)/u)
  assert.doesNotMatch(modal, /window\.terminay\.(?:getMcpInstallStatus|installMcpAgent|uninstallMcpAgent)/u)
  assert.match(preload, /exposeInMainWorld\('terminayMcpInstallHost'/u)
  assert.match(preload, /desktop:mcp-install-host:get-status/u)
  assert.match(preload, /agent !== 'claudeCode' && agent !== 'codex'/u)
  assert.doesNotMatch(preload, /mcp-install:(?:get-status|install|uninstall)/u)
  assert.match(main, /ipcMain\.handle\('desktop:mcp-install-host:get-status'[\s\S]{0,500}assertTrustedAppSender\(event\)/u)
  assert.match(main, /ipcMain\.handle\('desktop:mcp-install-host:install'[\s\S]{0,700}Object\.keys\(payload\)\.length !== 2/u)
  assert.match(main, /ipcMain\.handle\('desktop:mcp-install-host:uninstall'[\s\S]{0,700}assertTrustedAppSender\(event\)/u)
  assert.doesNotMatch(main, /mcp-install:(?:get-status|install|uninstall)/u)
  assert.match(declarations, /terminayMcpInstallHost\?:/u)
  assert.doesNotMatch(types, /getMcpInstallStatus|installMcpAgent|uninstallMcpAgent/u)
})
