import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { McpAgentRegistrationState, McpInstallActionResult } from '../../src/types/terminay'
import { atomicWriteConfig } from './atomicConfigWrite'
import type { McpServerCommand } from './index'

/** The MCP server key we register inside Claude Code's `mcpServers` map. */
const SERVER_KEY = 'terminay'

/** Absolute path to Claude Code's config file (`~/.claude.json`). */
export function getClaudeCodeConfigPath(homeDirectory = homedir()): string {
  return join(homeDirectory, '.claude.json')
}

interface ClaudeServerEntry {
  command: string
  args: string[]
  env?: Record<string, string>
}

interface ClaudeConfig {
  mcpServers?: Record<string, ClaudeServerEntry>
  [key: string]: unknown
}

/**
 * Read and parse the config file. Returns:
 * - `{ config }` when the file is missing (treated as `{}`) or parses cleanly.
 * - `{ error }` when the file exists, is non-empty, and fails to parse.
 */
async function readConfig(
  path: string,
): Promise<{ config: ClaudeConfig } | { error: string }> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return { config: {} }
    }
    return { error: `Could not read ${path}: ${describeError(cause)}` }
  }

  if (raw.trim().length === 0) {
    return { config: {} }
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: `${path} does not contain a JSON object; refusing to overwrite it.` }
    }
    return { config: parsed as ClaudeConfig }
  } catch (cause) {
    return { error: `Could not parse ${path} as JSON: ${describeError(cause)}` }
  }
}

/** True when a `terminay` server entry already exists in the config. */
export async function isClaudeCodeInstalled(homeDirectory?: string): Promise<boolean> {
  const result = await readConfig(getClaudeCodeConfigPath(homeDirectory))
  if ('error' in result) {
    // A file we cannot parse is reported as not-installed; the install/uninstall
    // actions surface the parse error to the user when they act on it.
    return false
  }
  return Boolean(result.config.mcpServers && SERVER_KEY in result.config.mcpServers)
}

export async function inspectClaudeCodeRegistration(
  server: McpServerCommand,
  homeDirectory?: string,
): Promise<{ state: McpAgentRegistrationState; message?: string }> {
  const result = await readConfig(getClaudeCodeConfigPath(homeDirectory))
  if ('error' in result) return { state: 'unavailable', message: result.error }
  const existing = result.config.mcpServers?.[SERVER_KEY]
  if (existing === undefined) return { state: 'not-installed' }
  const expected: ClaudeServerEntry = { command: server.command, args: server.args }
  if (server.env !== undefined) expected.env = server.env
  return isDeepStrictEqual(existing, expected)
    ? { state: 'installed' }
    : { state: 'changed', message: 'The existing Terminay MCP entry differs from this version of Terminay.' }
}

/** Register (or update) the `terminay` MCP server entry. */
export async function installClaudeCode(
  server: McpServerCommand,
  homeDirectory?: string,
): Promise<McpInstallActionResult> {
  const path = getClaudeCodeConfigPath(homeDirectory)
  try {
    const result = await readConfig(path)
    if ('error' in result) {
      return { ok: false, installed: await safeIsInstalled(homeDirectory), error: result.error }
    }

    const config = result.config
    const servers = config.mcpServers ?? {}
    const entry: ClaudeServerEntry = { command: server.command, args: server.args }
    if (server.env !== undefined) {
      entry.env = server.env
    }

    const existing = servers[SERVER_KEY]
    if (existing !== undefined && !isDeepStrictEqual(existing, entry)) {
      return changedEntryResult(path)
    }
    if (isDeepStrictEqual(existing, entry)) {
      return { ok: true, installed: true, message: `terminay is already registered in ${path}` }
    }

    servers[SERVER_KEY] = entry
    config.mcpServers = servers

    await atomicWriteConfig(path, `${JSON.stringify(config, null, 2)}\n`)
    return { ok: true, installed: true, message: `Registered terminay in ${path}` }
  } catch (cause) {
    return { ok: false, installed: await safeIsInstalled(homeDirectory), error: describeError(cause) }
  }
}

/** Remove the `terminay` MCP server entry. Idempotent. */
export async function uninstallClaudeCode(server?: McpServerCommand, homeDirectory?: string): Promise<McpInstallActionResult> {
  const path = getClaudeCodeConfigPath(homeDirectory)
  try {
    const result = await readConfig(path)
    if ('error' in result) {
      return { ok: false, installed: await safeIsInstalled(homeDirectory), error: result.error }
    }

    const config = result.config
    if (!config.mcpServers || !(SERVER_KEY in config.mcpServers)) {
      return { ok: true, installed: false, message: 'terminay was not registered' }
    }
    if (server !== undefined) {
      const expected: ClaudeServerEntry = { command: server.command, args: server.args }
      if (server.env !== undefined) expected.env = server.env
      if (!isDeepStrictEqual(config.mcpServers[SERVER_KEY], expected)) {
        return changedEntryResult(path)
      }
    }

    delete config.mcpServers[SERVER_KEY]
    await atomicWriteConfig(path, `${JSON.stringify(config, null, 2)}\n`)
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
    return await isClaudeCodeInstalled(homeDirectory)
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
