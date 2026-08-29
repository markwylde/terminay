import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { McpAgentRegistrationState, McpInstallActionResult } from '../../src/types/terminay'
import { atomicWriteConfig } from './atomicConfigWrite'
import type { McpServerCommand } from './index'
import {
  getCodexBlock,
  hasCodexBlock,
  removeCodexBlock,
  renderGrokBlock,
  upsertCodexBlock,
} from './tomlEntry'

/** Absolute path to Grok's config file (`$GROK_HOME/config.toml` or `~/.grok/config.toml`). */
export function getGrokConfigPath(homeDirectory = homedir()): string {
  const grokHome = process.env.GROK_HOME?.trim()
  if (homeDirectory === homedir() && grokHome) {
    return join(grokHome, 'config.toml')
  }
  return join(homeDirectory, '.grok', 'config.toml')
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
export async function isGrokInstalled(homeDirectory?: string): Promise<boolean> {
  try {
    const content = await readConfig(getGrokConfigPath(homeDirectory))
    return hasCodexBlock(content)
  } catch {
    return false
  }
}

export async function inspectGrokRegistration(
  server: McpServerCommand,
  homeDirectory?: string,
): Promise<{ state: McpAgentRegistrationState; message?: string }> {
  const path = getGrokConfigPath(homeDirectory)
  try {
    const existing = getCodexBlock(await readConfig(path))
    if (existing === null) return { state: 'not-installed' }
    return existing === renderGrokBlock(server)
      ? { state: 'installed' }
      : { state: 'changed', message: 'The existing Terminay MCP entry differs from this version of Terminay.' }
  } catch (cause) {
    return { state: 'unavailable', message: describeError(cause) }
  }
}

/** Register (or update) the `[mcp_servers.terminay]` block. */
export async function installGrok(
  server: McpServerCommand,
  homeDirectory?: string,
): Promise<McpInstallActionResult> {
  const path = getGrokConfigPath(homeDirectory)
  try {
    const content = await readConfig(path)
    const block = renderGrokBlock(server)
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
export async function uninstallGrok(server?: McpServerCommand, homeDirectory?: string): Promise<McpInstallActionResult> {
  const path = getGrokConfigPath(homeDirectory)
  try {
    const content = await readConfig(path)
    if (!hasCodexBlock(content)) {
      return { ok: true, installed: false, message: 'terminay was not registered' }
    }
    if (server !== undefined && getCodexBlock(content) !== renderGrokBlock(server)) {
      return changedEntryResult(path)
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
    return await isGrokInstalled(homeDirectory)
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
