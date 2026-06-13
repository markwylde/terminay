import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { McpInstallActionResult } from '../../src/types/terminay'
import type { McpServerCommand } from './index'
import { hasCodexBlock, removeCodexBlock, renderCodexBlock, upsertCodexBlock } from './tomlEntry'

/** Absolute path to Codex's config file (`~/.codex/config.toml`). */
export function getCodexConfigPath(): string {
  return join(homedir(), '.codex', 'config.toml')
}

/** Read the config file, returning `''` when it does not exist. */
async function readConfig(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return ''
    }
    throw cause
  }
}

/** True when the config file contains a `[mcp_servers.terminay]` block. */
export async function isCodexInstalled(): Promise<boolean> {
  try {
    const content = await readConfig(getCodexConfigPath())
    return hasCodexBlock(content)
  } catch {
    return false
  }
}

/** Register (or update) the `[mcp_servers.terminay]` block. */
export async function installCodex(server: McpServerCommand): Promise<McpInstallActionResult> {
  const path = getCodexConfigPath()
  try {
    const content = await readConfig(path)
    const block = renderCodexBlock(server)
    const next = upsertCodexBlock(content, block)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, next, 'utf8')
    return { ok: true, installed: true, message: `Registered terminay in ${path}` }
  } catch (cause) {
    return { ok: false, installed: await safeIsInstalled(), error: describeError(cause) }
  }
}

/** Remove the `[mcp_servers.terminay]` block. Idempotent. */
export async function uninstallCodex(): Promise<McpInstallActionResult> {
  const path = getCodexConfigPath()
  try {
    const content = await readConfig(path)
    if (!hasCodexBlock(content)) {
      return { ok: true, installed: false, message: 'terminay was not registered' }
    }
    const next = removeCodexBlock(content)
    await writeFile(path, next, 'utf8')
    return { ok: true, installed: false, message: `Removed terminay from ${path}` }
  } catch (cause) {
    return { ok: false, installed: await safeIsInstalled(), error: describeError(cause) }
  }
}

async function safeIsInstalled(): Promise<boolean> {
  try {
    return await isCodexInstalled()
  } catch {
    return false
  }
}

function describeError(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message
  }
  return String(cause)
}
