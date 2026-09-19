import type { TerminayExtension } from '@terminay/extension-api';
import { defineExtension } from '@terminay/extension-api';
import type { McpInstallTargetOptions } from './mcp/targets.js';
import { createMcpInstallTargets } from './mcp/targets.js';
import type { SessionSourceOptions } from './source.js';
import { createSessionSource } from './source.js';

export const EXTENSION_ID = 'com.terminay.builtin-agents';
export const SESSION_SOURCE_ID = `${EXTENSION_ID}/agents`;

export type {
	McpInstallTargetDefinition,
	McpInstallTargetOptions,
} from './mcp/targets.js';
export {
	createMcpInstallTargets,
	MCP_TARGET_LOCAL_IDS,
} from './mcp/targets.js';
export type { HarnessDefinition, SessionSourceOptions } from './source.js';
export { createSessionSource, HARNESSES } from './source.js';

export type BuiltInAgentsOptions = {
	source?: SessionSourceOptions;
	mcp?: McpInstallTargetOptions;
};

/** Builds the extension. The default export uses the real library providers and home directory. */
export function createBuiltInAgentsExtension(
	options: BuiltInAgentsOptions = {},
): TerminayExtension {
	return defineExtension({
		activate(context) {
			context.subscriptions.add(
				context.agents.registerSessionSource(
					SESSION_SOURCE_ID,
					createSessionSource(options.source),
				),
			);
			for (const target of createMcpInstallTargets(options.mcp)) {
				context.subscriptions.add(
					context.mcp.registerInstallTarget(
						`${EXTENSION_ID}/${target.localId}`,
						target.runtime,
					),
				);
			}
		},
	});
}

export default createBuiltInAgentsExtension();
