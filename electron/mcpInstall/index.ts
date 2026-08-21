import type {
  McpAgentId,
  McpAgentInstallState,
  McpInstallActionResult,
  McpInstallStatus,
} from '../../src/types/terminay'
import {
  getClaudeCodeConfigPath,
  inspectClaudeCodeRegistration,
  installClaudeCode,
  isClaudeCodeInstalled,
  uninstallClaudeCode,
} from './claudeCode'
import { getCodexConfigPath, inspectCodexRegistration, installCodex, isCodexInstalled, uninstallCodex } from './codex'

/**
 * The launch command for the Terminay MCP server. The integrator (main.ts)
 * computes this — e.g. `{ command: '/path/Terminay',
 * args: ['/path/dist-electron/mcpEntry.js'], env: { ELECTRON_RUN_AS_NODE: '1' } }`
 * — and passes it in; nothing here hardcodes paths.
 */
export interface McpServerCommand {
  command: string
  args: string[]
  env?: Record<string, string>
}

const AGENT_LABELS: Record<McpAgentId, string> = {
  claudeCode: 'Claude Code',
  codex: 'Codex',
}

export type McpInstallOptions = {
  homeDirectory?: string
}

/** Detect, for every supported agent, whether the `terminay` server is registered. */
export async function getMcpInstallStatus(
  server?: McpServerCommand,
  options: McpInstallOptions = {},
): Promise<McpInstallStatus> {
  const [claude, codex] = server === undefined
    ? await Promise.all([
      isClaudeCodeInstalled(options.homeDirectory).then((installed) => ({ state: installed ? 'installed' as const : 'not-installed' as const, message: undefined })),
      isCodexInstalled(options.homeDirectory).then((installed) => ({ state: installed ? 'installed' as const : 'not-installed' as const, message: undefined })),
    ])
    : await Promise.all([
      inspectClaudeCodeRegistration(server, options.homeDirectory),
      inspectCodexRegistration(server, options.homeDirectory),
    ])

  const agents: McpAgentInstallState[] = [
    {
      id: 'claudeCode',
      label: AGENT_LABELS.claudeCode,
      state: claude.state,
      installed: claude.state === 'installed' || claude.state === 'changed',
      configPath: getClaudeCodeConfigPath(options.homeDirectory),
      ...(claude.message === undefined ? {} : { message: claude.message }),
    },
    {
      id: 'codex',
      label: AGENT_LABELS.codex,
      state: codex.state,
      installed: codex.state === 'installed' || codex.state === 'changed',
      configPath: getCodexConfigPath(options.homeDirectory),
      ...(codex.message === undefined ? {} : { message: codex.message }),
    },
  ]

  return { agents }
}

/** Register the `terminay` MCP server for the given agent. Never throws. */
export async function installMcpAgent(
  agent: McpAgentId,
  server: McpServerCommand,
  options: McpInstallOptions = {},
): Promise<McpInstallActionResult> {
  switch (agent) {
    case 'claudeCode':
      return installClaudeCode(server, options.homeDirectory)
    case 'codex':
      return installCodex(server, options.homeDirectory)
    default:
      return unknownAgent(agent)
  }
}

/** Unregister the `terminay` MCP server for the given agent. Never throws. */
export async function uninstallMcpAgent(
  agent: McpAgentId,
  server?: McpServerCommand,
  options: McpInstallOptions = {},
): Promise<McpInstallActionResult> {
  switch (agent) {
    case 'claudeCode':
      return uninstallClaudeCode(server, options.homeDirectory)
    case 'codex':
      return uninstallCodex(server, options.homeDirectory)
    default:
      return unknownAgent(agent)
  }
}

function unknownAgent(agent: never): McpInstallActionResult {
  return { ok: false, installed: false, error: `Unknown agent: ${String(agent)}` }
}
