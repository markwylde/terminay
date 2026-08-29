import type {
  McpAgentId,
  McpAgentInstallState,
  McpAgentRegistrationState,
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
import {
  getCursorConfigPath,
  inspectCursorRegistration,
  installCursor,
  isCursorInstalled,
  uninstallCursor,
} from './cursor'
import {
  getGeminiConfigPath,
  inspectGeminiRegistration,
  installGemini,
  isGeminiInstalled,
  uninstallGemini,
} from './gemini'
import {
  getGrokConfigPath,
  inspectGrokRegistration,
  installGrok,
  isGrokInstalled,
  uninstallGrok,
} from './grok'
import {
  getOpenCodeConfigPath,
  inspectOpenCodeRegistration,
  installOpenCode,
  isOpenCodeInstalled,
  resolveOpenCodeConfigPath,
  uninstallOpenCode,
} from './openCode'

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

type McpRegistrationInspection = {
  state: McpAgentRegistrationState
  message?: string
}

type McpInstallProvider = Readonly<{
  id: McpAgentId
  label: string
  getConfigPath(homeDirectory?: string): string | Promise<string>
  inspect(server: McpServerCommand, homeDirectory?: string): Promise<McpRegistrationInspection>
  isInstalled(homeDirectory?: string): Promise<boolean>
  install(server: McpServerCommand, homeDirectory?: string): Promise<McpInstallActionResult>
  uninstall(server: McpServerCommand | undefined, homeDirectory?: string): Promise<McpInstallActionResult>
}>

/**
 * Provider-owned registration adapters. Keeping the supported clients in one
 * ordered registry makes detection, actions, and UI rows use identical routing.
 */
export const MCP_INSTALL_PROVIDERS: readonly McpInstallProvider[] = [
  {
    id: 'claudeCode',
    label: 'Claude Code',
    getConfigPath: getClaudeCodeConfigPath,
    inspect: inspectClaudeCodeRegistration,
    isInstalled: isClaudeCodeInstalled,
    install: installClaudeCode,
    uninstall: uninstallClaudeCode,
  },
  {
    id: 'codex',
    label: 'Codex',
    getConfigPath: getCodexConfigPath,
    inspect: inspectCodexRegistration,
    isInstalled: isCodexInstalled,
    install: installCodex,
    uninstall: uninstallCodex,
  },
  {
    id: 'cursor',
    label: 'Cursor CLI',
    getConfigPath: getCursorConfigPath,
    inspect: inspectCursorRegistration,
    isInstalled: isCursorInstalled,
    install: installCursor,
    uninstall: uninstallCursor,
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    getConfigPath: getGeminiConfigPath,
    inspect: inspectGeminiRegistration,
    isInstalled: isGeminiInstalled,
    install: installGemini,
    uninstall: uninstallGemini,
  },
  {
    id: 'grok',
    label: 'Grok',
    getConfigPath: getGrokConfigPath,
    inspect: inspectGrokRegistration,
    isInstalled: isGrokInstalled,
    install: installGrok,
    uninstall: uninstallGrok,
  },
  {
    id: 'openCode',
    label: 'OpenCode',
    getConfigPath: resolveOpenCodeConfigPath,
    inspect: inspectOpenCodeRegistration,
    isInstalled: isOpenCodeInstalled,
    install: installOpenCode,
    uninstall: uninstallOpenCode,
  },
]

const PROVIDER_BY_ID: ReadonlyMap<McpAgentId, McpInstallProvider> = new Map(
  MCP_INSTALL_PROVIDERS.map((provider) => [provider.id, provider]),
)

async function getProviderConfigPath(
  provider: McpInstallProvider,
  homeDirectory?: string,
): Promise<string> {
  try {
    return await provider.getConfigPath(homeDirectory)
  } catch {
    // The inspection contains the provider-specific reason (such as ambiguous
    // OpenCode configuration candidates). Keep the usual canonical path useful
    // for review if resolving the active path itself fails.
    return provider.id === 'openCode'
      ? getOpenCodeConfigPath(homeDirectory)
      : await provider.getConfigPath(homeDirectory)
  }
}

export type McpInstallOptions = {
  homeDirectory?: string
}

/** Detect, for every supported agent, whether the `terminay` server is registered. */
export async function getMcpInstallStatus(
  server?: McpServerCommand,
  options: McpInstallOptions = {},
): Promise<McpInstallStatus> {
  const agents = await Promise.all(MCP_INSTALL_PROVIDERS.map(async (provider) => {
    const registrationPromise: Promise<McpRegistrationInspection> = server === undefined
      ? provider.isInstalled(options.homeDirectory).then((installed) => ({
        state: installed ? 'installed' as const : 'not-installed' as const,
      }))
      : provider.inspect(server, options.homeDirectory)
    const [registration, configPath] = await Promise.all([
      registrationPromise,
      getProviderConfigPath(provider, options.homeDirectory),
    ])
    return {
      id: provider.id,
      label: provider.label,
      state: registration.state,
      installed: registration.state === 'installed' || registration.state === 'changed',
      configPath,
      ...(registration.message === undefined ? {} : { message: registration.message }),
    } satisfies McpAgentInstallState
  }))

  return { agents }
}

/** Register the `terminay` MCP server for the given agent. Never throws. */
export async function installMcpAgent(
  agent: McpAgentId,
  server: McpServerCommand,
  options: McpInstallOptions = {},
): Promise<McpInstallActionResult> {
  const provider = PROVIDER_BY_ID.get(agent)
  return provider === undefined
    ? unknownAgent(agent)
    : provider.install(server, options.homeDirectory)
}

/** Unregister the `terminay` MCP server for the given agent. Never throws. */
export async function uninstallMcpAgent(
  agent: McpAgentId,
  server?: McpServerCommand,
  options: McpInstallOptions = {},
): Promise<McpInstallActionResult> {
  const provider = PROVIDER_BY_ID.get(agent)
  return provider === undefined
    ? unknownAgent(agent)
    : provider.uninstall(server, options.homeDirectory)
}

function unknownAgent(agent: unknown): McpInstallActionResult {
  return { ok: false, installed: false, error: `Unknown agent: ${String(agent)}` }
}
