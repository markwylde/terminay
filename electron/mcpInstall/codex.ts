import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { McpInstallActionResult } from '../../src/types/terminay'
import { atomicWriteConfig } from './atomicConfigWrite'
import type { McpServerCommand } from './index'
import {
  getCodexBlock,
  hasCodexBlock,
  removeCodexBlock,
  renderCodexBlock,
  upsertCodexBlock,
} from './tomlEntry'

/** Absolute path to Codex's config file (`~/.codex/config.toml`). */
export function getCodexConfigPath(homeDirectory = homedir()): string {
  return join(homeDirectory, '.codex', 'config.toml')
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
export async function isCodexInstalled(homeDirectory?: string): Promise<boolean> {
  try {
    const content = await readConfig(getCodexConfigPath(homeDirectory))
    return hasCodexBlock(content)
  } catch {
    return false
  }
}

/** Register (or update) the `[mcp_servers.terminay]` block. */
export async function installCodex(
  server: McpServerCommand,
  homeDirectory?: string,
): Promise<McpInstallActionResult> {
  const path = getCodexConfigPath(homeDirectory)
  try {
    const content = await readConfig(path)
    const block = renderCodexBlock(server)
    const existing = getCodexBlock(content)
    if (existing !== null && existing !== block) {
      return changedEntryResult(path)
    }
    if (existing === block) {
      return { ok: true, installed: true, message: `terminay is already registered in ${path}` }
    }

    const next = upsertCodexBlock(content, block)
    await atomicWriteConfig(path, next)
    return { ok: true, installed: true, message: `Registered terminay in ${path}` }
  } catch (cause) {
    return { ok: false, installed: await safeIsInstalled(homeDirectory), error: describeError(cause) }
  }
}

/** Remove the `[mcp_servers.terminay]` block. Idempotent. */
export async function uninstallCodex(homeDirectory?: string): Promise<McpInstallActionResult> {
  const path = getCodexConfigPath(homeDirectory)
  try {
    const content = await readConfig(path)
    if (!hasCodexBlock(content)) {
      return { ok: true, installed: false, message: 'terminay was not registered' }
    }
    const next = removeCodexBlock(content)
    await atomicWriteConfig(path, next)
    return { ok: true, installed: false, message: `Removed terminay from ${path}` }
  } catch (cause) {
    return { ok: false, installed: await safeIsInstalled(homeDirectory), error: describeError(cause) }
  }
}

function changedEntryResult(path: string): McpInstallActionResult {
  return {
    ok: false,
    installed: true,
    error: `The existing terminay entry in ${path} has changed; review it before replacing it.`,
  }
}

async function safeIsInstalled(homeDirectory?: string): Promise<boolean> {
  try {
    return await isCodexInstalled(homeDirectory)
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
