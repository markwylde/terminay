import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { McpInstallActionResult } from '../../src/types/terminay'
import type { McpServerCommand } from './index'

/** The MCP server key we register inside Claude Code's `mcpServers` map. */
const SERVER_KEY = 'terminay'

/** Absolute path to Claude Code's config file (`~/.claude.json`). */
export function getClaudeCodeConfigPath(): string {
  return join(homedir(), '.claude.json')
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
export async function isClaudeCodeInstalled(): Promise<boolean> {
  const result = await readConfig(getClaudeCodeConfigPath())
  if ('error' in result) {
    // A file we cannot parse is reported as not-installed; the install/uninstall
    // actions surface the parse error to the user when they act on it.
    return false
  }
  return Boolean(result.config.mcpServers && SERVER_KEY in result.config.mcpServers)
}

/** Register (or update) the `terminay` MCP server entry. */
export async function installClaudeCode(server: McpServerCommand): Promise<McpInstallActionResult> {
  const path = getClaudeCodeConfigPath()
  try {
    const result = await readConfig(path)
    if ('error' in result) {
      return { ok: false, installed: await safeIsInstalled(), error: result.error }
    }

    const config = result.config
    const servers = config.mcpServers ?? {}
    const entry: ClaudeServerEntry = { command: server.command, args: server.args }
    if (server.env !== undefined) {
      entry.env = server.env
    }
    servers[SERVER_KEY] = entry
    config.mcpServers = servers

    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    return { ok: true, installed: true, message: `Registered terminay in ${path}` }
  } catch (cause) {
    return { ok: false, installed: await safeIsInstalled(), error: describeError(cause) }
  }
}

/** Remove the `terminay` MCP server entry. Idempotent. */
export async function uninstallClaudeCode(): Promise<McpInstallActionResult> {
  const path = getClaudeCodeConfigPath()
  try {
    const result = await readConfig(path)
    if ('error' in result) {
      return { ok: false, installed: await safeIsInstalled(), error: result.error }
    }

    const config = result.config
    if (!config.mcpServers || !(SERVER_KEY in config.mcpServers)) {
      return { ok: true, installed: false, message: 'terminay was not registered' }
    }

    delete config.mcpServers[SERVER_KEY]
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    return { ok: true, installed: false, message: `Removed terminay from ${path}` }
  } catch (cause) {
    return { ok: false, installed: await safeIsInstalled(), error: describeError(cause) }
  }
}

async function safeIsInstalled(): Promise<boolean> {
  try {
    return await isClaudeCodeInstalled()
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
