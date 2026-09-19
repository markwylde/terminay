import type {
	McpInstallTargetActionResult,
	McpInstallTargetRuntime,
	McpInstallTargetStatus,
} from '@terminay/extension-api';
import { defineMcpInstallTarget } from '@terminay/extension-api';
import type { McpInstallProvider } from './index.js';
import { getProviderConfigPath, MCP_INSTALL_PROVIDERS } from './index.js';
import type { McpAgentId } from './types.js';

/** Target-local ids, in the order the install surface lists them. */
export const MCP_TARGET_LOCAL_IDS: Readonly<Record<McpAgentId, string>> = {
	claudeCode: 'claude-code',
	codex: 'codex',
	cursor: 'cursor',
	gemini: 'gemini',
	grok: 'grok',
	openCode: 'opencode',
};

export type McpInstallTargetOptions = {
	/** Test seam: resolve every client's configuration below this directory. */
	homeDirectory?: string;
};

export type McpInstallTargetDefinition = Readonly<{
	localId: string;
	displayName: string;
	runtime: McpInstallTargetRuntime;
}>;

/** One install target per supported client, each wrapping its registration writer. */
export function createMcpInstallTargets(
	options: McpInstallTargetOptions = {},
): McpInstallTargetDefinition[] {
	return MCP_INSTALL_PROVIDERS.map((provider) => ({
		localId: MCP_TARGET_LOCAL_IDS[provider.id],
		displayName: provider.label,
		runtime: createTarget(provider, options.homeDirectory),
	}));
}

function createTarget(
	provider: McpInstallProvider,
	homeDirectory: string | undefined,
): McpInstallTargetRuntime {
	return defineMcpInstallTarget({
		async status({ server }): Promise<McpInstallTargetStatus> {
			const configPath = await getProviderConfigPath(provider, homeDirectory);
			try {
				const inspection = await provider.inspect(server, homeDirectory);
				return {
					state: inspection.state,
					configPath,
					...(inspection.message === undefined
						? {}
						: { message: inspection.message }),
				};
			} catch (cause) {
				return { state: 'error', configPath, message: describe(cause) };
			}
		},
		async install({ server, signal }): Promise<McpInstallTargetActionResult> {
			if (signal.aborted) return cancelled();
			return provider.install(server, homeDirectory);
		},
		async uninstall({ server, signal }): Promise<McpInstallTargetActionResult> {
			if (signal.aborted) return cancelled();
			return provider.uninstall(server, homeDirectory);
		},
	});
}

function cancelled(): McpInstallTargetActionResult {
	return { ok: false, installed: false, error: 'The request was cancelled.' };
}

function describe(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
