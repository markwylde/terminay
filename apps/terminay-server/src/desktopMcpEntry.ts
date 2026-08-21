import { runServerMcpStdio } from './mcp/stdio.js';

// This entry is embedded in the Desktop application's unpacked resources.
// Standalone archive integrity belongs to the standalone CLI entrypoint; it
// must not be applied to this distinct, verified Desktop artifact layout.
const socketPath = process.env.TERMINAY_CONTROL_SOCKET ?? '';
const token = process.env.TERMINAY_CONTROL_TOKEN ?? '';

runServerMcpStdio({ socketPath, token }).catch((error: unknown) => {
	process.stderr.write(
		`terminay desktop MCP failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
	);
	process.exitCode = 1;
});
