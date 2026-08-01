export { createControlClient } from './client'
export type { ControlClient } from './client'
export { runMcpServer } from './server'

/**
 * The Electron MCP entry is retained as a compatibility adapter while the
 * server-owned entry is composed into the Desktop host. It has no direct
 * renderer import, but its host-side control boundary is still transitional.
 */
export const ELECTRON_MCP_COMPATIBILITY = Object.freeze({
  id: 'terminay-electron-mcp-compatibility',
  status: 'compatibility-only',
  source: 'electron/mcpEntry.ts',
  directRendererDependency: false,
  replacement: '@terminay/server:dist/mcpEntry.js',
  removalBoundary: 'electron/main.ts',
} as const)
