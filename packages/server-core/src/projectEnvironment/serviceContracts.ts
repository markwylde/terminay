import type { JsonValue } from '@terminay/protocol';
import type { PtyProcess, PtySpawnOptions } from '../terminalService/types.js';

/** Concrete privileged operations implemented by This server and connection
 * providers. Provider-specific management actions remain outside this map. */
export interface ProjectEnvironmentServiceOperations {
	readonly terminal: {
		readonly 'resolve-launch': {
			readonly input: Readonly<{ profileId?: string; cwd?: string; activePanelId?: string; cols: number; rows: number }>;
			readonly output: RemoteTerminalLaunch;
		};
		readonly spawn: { readonly input: PtySpawnOptions; readonly output: PtyProcess };
	};
	readonly filesystem: {
		readonly 'prepare-project-root': { readonly input: Readonly<{ root: string }>; readonly output: PreparedRemoteProjectRoot };
		readonly 'commit-project-root': { readonly input: Readonly<{ preparationId: string }>; readonly output: null };
		readonly protocol: { readonly input: ProjectProtocolOperationInput; readonly output: JsonValue };
	};
	readonly 'filesystem-observation': { readonly protocol: { readonly input: ProjectProtocolOperationInput; readonly output: JsonValue } };
	readonly git: { readonly protocol: { readonly input: ProjectProtocolOperationInput; readonly output: JsonValue } };
	readonly 'process-observation': { readonly protocol: { readonly input: ProjectProtocolOperationInput; readonly output: JsonValue } };
	readonly 'agent-journal': { readonly protocol: { readonly input: ProjectProtocolOperationInput; readonly output: JsonValue } };
	readonly 'shell-discovery': { readonly protocol: { readonly input: ProjectProtocolOperationInput; readonly output: JsonValue } };
	readonly infrastructure: { readonly protocol: { readonly input: ProjectProtocolOperationInput; readonly output: JsonValue } };
}

export interface RemoteTerminalLaunch {
	readonly profile: Readonly<{ id: string; revision: number; name: string; targetSummary: string; icon?: string; color?: string }>;
	readonly shellPath: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly settingsRevision?: number;
}

export interface PreparedRemoteProjectRoot {
	readonly canonicalRoot: string;
	readonly preparationId: string;
}

export interface ProjectProtocolOperationInput {
	readonly payload: JsonValue;
	readonly body?: string;
	readonly request: Readonly<{ clientId: string; authScope: string; expectedRevision?: number }>;
}
