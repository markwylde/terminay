import type {
	AgentSessionSourceContribution,
	ExtensionDependency,
	LanguageServerContribution,
	McpInstallTargetContribution,
} from '@terminay/extension-api';

export type ExtensionHostState =
	| 'stopped'
	| 'starting'
	| 'running'
	| 'failed'
	| 'quarantined';

export interface ExtensionLaunchDescriptor {
	readonly extensionId: string;
	readonly packageRoot: string;
	readonly entrypoint: string;
	readonly configDirectory: string;
	readonly dataDirectory: string;
	readonly cacheDirectory: string;
	readonly permissions: readonly string[];
	/** Parsed public manifest contribution metadata. The installer supplies it
	 * after public manifest validation; the host uses it to reject undeclared
	 * child registrations before they become live. */
	readonly agentSessionSources?: readonly AgentSessionSourceContribution[];
	/** Declared MCP install targets, checked the same way. */
	readonly mcpInstallTargets?: readonly McpInstallTargetContribution[];
	/** Declared language servers. The host refuses a child registration that
	 * this array does not contain. */
	readonly languageServers?: readonly LanguageServerContribution[];
	readonly extensionDependencies?: readonly ExtensionDependency[];
}

export interface ExtensionHostStatus {
	readonly extensionId: string;
	readonly state: ExtensionHostState;
	readonly consecutiveCrashes: number;
	readonly restartAt?: number;
	readonly failure?: string;
	readonly agentSessionSources?: readonly AgentSessionSourceContribution[];
	readonly mcpInstallTargets?: readonly McpInstallTargetContribution[];
	readonly languageServers?: readonly LanguageServerContribution[];
}

export interface ExtensionInvocation {
	readonly method: string;
	readonly input?: unknown;
	readonly deadlineMs?: number;
	readonly signal?: AbortSignal;
}

export interface ExtensionBrokerRequest {
	readonly extensionId: string;
	readonly operation: 'log' | 'secret.resolve';
	readonly payload: unknown;
}

export interface ExtensionSecretAccessBroker {
	withSecret<T>(
		principal: { extensionId: string; permissions: ReadonlySet<string> },
		request: { profileId: string; fieldId: string },
		callback: (secret: Uint8Array) => T | Promise<T>,
	): Promise<T>;
}

export interface ExtensionBroker {
	request(
		request: ExtensionBrokerRequest,
		signal: AbortSignal,
	): Promise<unknown>;
}

/**
 * Private host bridge for session-source publications. Installed extensions
 * never receive it: the host validates a publication's frame, then hands it
 * here, where validation of every snapshot, ordering, project scope, and
 * terminal binding stay in Server Core.
 */
export interface ExtensionAgentBroker {
	publish(
		request: Readonly<{
			extensionId: string;
			sourceId: string;
			publication: Readonly<{
				reset?: readonly unknown[];
				upserts?: readonly unknown[];
				removals?: readonly unknown[];
			}>;
		}>,
		signal: AbortSignal,
	): Promise<Readonly<{ ok: boolean; resend?: boolean; failure?: string }>>;
	diagnostic?(
		request: Readonly<{
			extensionId: string;
			sourceId: string;
			diagnostic: unknown;
		}>,
	): void;
	/** A source stopped: disposed, its extension stopped, or its child died. */
	sourceStopped?(
		request: Readonly<{ extensionId: string; sourceId: string }>,
	): void;
}

export interface ExtensionHostLimits {
	readonly maxMessageBytes?: number;
	readonly maxConcurrentInvocations?: number;
	readonly startupTimeoutMs?: number;
	readonly invocationTimeoutMs?: number;
	readonly shutdownTimeoutMs?: number;
	readonly crashWindowMs?: number;
	readonly maxCrashesInWindow?: number;
	readonly initialBackoffMs?: number;
	readonly maxBackoffMs?: number;
}
