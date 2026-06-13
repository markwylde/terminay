import type {
  McpAgentId,
  McpAgentInstallState,
  McpInstallActionResult,
  McpInstallStatus,
} from '../../src/types/terminay'
import {
  getClaudeCodeConfigPath,
  installClaudeCode,
  isClaudeCodeInstalled,
  uninstallClaudeCode,
} from './claudeCode'
import { getCodexConfigPath, installCodex, isCodexInstalled, uninstallCodex } from './codex'

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

/** Detect, for every supported agent, whether the `terminay` server is registered. */
export async function getMcpInstallStatus(): Promise<McpInstallStatus> {
  const [claudeInstalled, codexInstalled] = await Promise.all([
    isClaudeCodeInstalled(),
    isCodexInstalled(),
  ])

  const agents: McpAgentInstallState[] = [
    {
      id: 'claudeCode',
      label: AGENT_LABELS.claudeCode,
      installed: claudeInstalled,
      configPath: getClaudeCodeConfigPath(),
    },
    {
      id: 'codex',
      label: AGENT_LABELS.codex,
      installed: codexInstalled,
      configPath: getCodexConfigPath(),
    },
  ]

  return { agents }
}

/** Register the `terminay` MCP server for the given agent. Never throws. */
export async function installMcpAgent(
  agent: McpAgentId,
  server: McpServerCommand,
): Promise<McpInstallActionResult> {
  switch (agent) {
    case 'claudeCode':
      return installClaudeCode(server)
    case 'codex':
      return installCodex(server)
    default:
      return unknownAgent(agent)
  }
}

/** Unregister the `terminay` MCP server for the given agent. Never throws. */
export async function uninstallMcpAgent(agent: McpAgentId): Promise<McpInstallActionResult> {
  switch (agent) {
    case 'claudeCode':
      return uninstallClaudeCode()
    case 'codex':
      return uninstallCodex()
    default:
      return unknownAgent(agent)
  }
}

function unknownAgent(agent: never): McpInstallActionResult {
  return { ok: false, installed: false, error: `Unknown agent: ${String(agent)}` }
}
