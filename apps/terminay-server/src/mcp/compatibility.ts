/**
 * Machine-readable ownership metadata for the local MCP boundary.
 *
 * Keep this metadata next to the server adapter so artifact and migration
 * checks can distinguish the canonical entry from the transitional Electron
 * host without importing either UI or Electron code.
 */
export const MCP_COMPATIBILITY_SCHEMA_VERSION = 1 as const;

export const SERVER_MCP_ENTRY = Object.freeze({
  id: "terminay-server-mcp",
  authority: "server",
  transport: "stdio",
  command: "terminay-mcp",
  artifact: "dist/mcpEntry.js",
  controlTransport: "local-socket",
  rendererDependency: false,
  electronDependency: false,
  networkExposed: false,
  requiredEnvironment: [
    "TERMINAY_CONTROL_SOCKET",
    "TERMINAY_CONTROL_TOKEN",
  ] as const,
  protocolVersion: "1",
} as const);

/**
 * The legacy Electron entry remains available only while the host migration
 * is staged. It is not the server authority and must not be treated as proof
 * that the forbidden Electron forwarding path has been removed.
 */
export const MCP_COMPATIBILITY_METADATA = Object.freeze({
  schemaVersion: MCP_COMPATIBILITY_SCHEMA_VERSION,
  authoritativeEntry: SERVER_MCP_ENTRY,
  compatibilityEntries: {
    electron: {
      id: "terminay-electron-mcp-compatibility",
      status: "compatibility-only",
      source: "electron/mcpEntry.ts",
      directRendererDependency: false,
      hostBoundary: "electron/main.ts",
      removalCondition: "server-runtime-composed-into-electron",
    },
  },
} as const);

export type ServerMcpEntryMetadata = typeof SERVER_MCP_ENTRY;
export type McpCompatibilityMetadata = typeof MCP_COMPATIBILITY_METADATA;
