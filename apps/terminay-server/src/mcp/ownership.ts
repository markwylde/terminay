export const SERVER_MCP_ENTRY = Object.freeze({
	id: 'terminay-server-mcp',
	authority: 'server',
	transport: 'stdio',
	command: 'terminay-mcp',
	artifact: 'dist/mcpEntry.js',
	controlTransport: 'local-socket',
	rendererDependency: false,
	electronDependency: false,
	networkExposed: false,
	requiredEnvironment: [
		'TERMINAY_CONTROL_SOCKET',
		'TERMINAY_CONTROL_TOKEN',
	] as const,
	protocolVersion: '1',
} as const);

export type ServerMcpEntryMetadata = typeof SERVER_MCP_ENTRY;
