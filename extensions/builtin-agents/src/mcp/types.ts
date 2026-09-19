export type { McpServerCommand } from '@terminay/extension-api';

/** A client whose user-wide MCP registration this extension can manage. */
export type McpAgentId =
	| 'claudeCode'
	| 'codex'
	| 'cursor'
	| 'gemini'
	| 'grok'
	| 'openCode';

export type McpAgentRegistrationState =
	| 'not-installed'
	| 'installed'
	| 'changed'
	| 'unavailable';

export interface McpAgentInstallState {
	id: McpAgentId;
	label: string;
	state: McpAgentRegistrationState;
	installed: boolean;
	/** Provider-owned registration location, for transparent review. */
	configPath: string;
	message?: string;
}

export interface McpInstallStatus {
	agents: McpAgentInstallState[];
}

export interface McpInstallActionResult {
	ok: boolean;
	installed: boolean;
	message?: string;
	error?: string;
}
