const { createRequire } = require('node:module');
const { symlinkSync } = require('node:fs');

// Resolve from the adapter so sign-in and inference use its exact SDK runtime.
function claudeExecutable(adapterManifest, arch = process.arch) {
	if (!['x64', 'arm64'].includes(arch))
		throw new Error(`Unsupported Claude bot architecture: ${arch}`);
	const adapter = createRequire(adapterManifest);
	const sdk = createRequire(adapter.resolve('@anthropic-ai/claude-agent-sdk'));
	return sdk.resolve(`@anthropic-ai/claude-agent-sdk-linux-${arch}/claude`);
}
module.exports = { claudeExecutable };
if (require.main === module) {
	const executable = claudeExecutable(
		'/usr/local/lib/node_modules/@agentclientprotocol/claude-agent-acp/package.json',
	);
	symlinkSync(executable, '/usr/local/bin/claude');
}
