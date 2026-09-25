export const EXTENSION_MANIFEST_VERSION = 1 as const;
/**
 * The public extension SDK version implemented by this host. 2.0 removed the
 * project-environment provider contribution kind. 2.1 added the language
 * server contribution kind. 3.0 replaced terminal-scoped agent providers, the
 * observation broker, the lifecycle publisher, and the driver toolkit with
 * machine-wide agent session sources, and added MCP install targets, so every
 * extension declaring `^2.x` is incompatible with this host. 3.1 added
 * worktree insight sources.
 */
export const EXTENSION_API_VERSION = '3.1.0' as const;

export const EXTENSION_LIMITS = Object.freeze({
	manifestBytes: 64 * 1024,
	extensionIdLength: 128,
	providerIdLength: 192,
	displayNameLength: 96,
	descriptionLength: 1_024,
	contributions: 32,
	permissions: 32,
	dependencies: 32,
	/** Target-owned opaque vault keys and purposes; never vault paths or ids. */
	providerVaultBindingKeyLength: 256,
	providerVaultBindingRefLength: 256,
	providerVaultPurposeLength: 128,
	providerVaultSecretBytes: 64 * 1024,
	providerVaultIdempotencyKeyLength: 256,
	stringLength: 4_096,
	messageBytes: 1024 * 1024,
	deadlineMs: 120_000,
	/** Harnesses one session source may report, e.g. Claude Code and Codex. */
	agentSourceHarnesses: 16,
	/** Server environment variable names one session source may request. */
	agentEnvironmentVariables: 32,
	agentEnvironmentVariableNameLength: 128,
	/** Live sessions in one reset; a larger machine is reported by upserts. */
	agentSessionsPerReset: 1_024,
	agentSessionIdLength: 256,
	agentPathLength: 4_096,
	agentTitleLength: 512,
	agentModelLength: 256,
	agentWaitingForLength: 1_024,
	agentToolNameLength: 256,
	agentErrorLength: 1_024,
	agentSubagents: 64,
	agentSubagentTypeLength: 128,
	agentDiagnosticCodeLength: 64,
	agentDiagnosticLength: 512,
	/** MCP install targets and the host-supplied Terminay MCP server command. */
	mcpInstallTargets: 16,
	mcpCommandLength: 4_096,
	mcpCommandArgs: 64,
	mcpCommandEnvEntries: 32,
	mcpConfigPathLength: 4_096,
	mcpMessageLength: 1_024,
	/** Language server contributions and the launch they may describe. */
	maxLanguageServers: 8,
	maxLanguageIds: 32,
	maxFileExtensions: 32,
	maxLaunchArgs: 64,
	maxLaunchEnvEntries: 32,
	maxLaunchDescriptionLength: 200,
	/** Worktree insight sources and the properties they may publish. */
	worktreeInsightSources: 8,
	worktreeTitleLength: 512,
	worktreeUrlLength: 2_048,
	worktreeCheckNameLength: 256,
	worktreeCheckItems: 100,
	worktreeCheckCount: 10_000,
	worktreeProviderNameLength: 64,
} as const);

/** A language id such as `typescriptreact`; never a path or a selector. */
export const LANGUAGE_ID_PATTERN = /^[a-z][a-z0-9+#._-]{0,63}$/;
/** A lower-case file extension with its leading dot, e.g. `.tsx`. */
export const FILE_EXTENSION_PATTERN = /^\.[a-z0-9][a-z0-9._-]{0,63}$/;

export const EXTENSION_ID_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{1,126}[a-z0-9])?$/;
export const LOCAL_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
/** A durable opaque token, never a vault path or a host-global secret id. */
export const PROVIDER_VAULT_BINDING_REF_PATTERN = /^[A-Za-z0-9_-]{16,256}$/;
/** A provider-owned logical key/purpose; never a filesystem or vault path. */
export const PROVIDER_VAULT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
export const ENVIRONMENT_VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function namespacedId(extensionId: string, localId: string): string {
	if (!EXTENSION_ID_PATTERN.test(extensionId))
		throw new Error('invalid extension id');
	if (!LOCAL_ID_PATTERN.test(localId)) throw new Error('invalid local id');
	return `${extensionId}/${localId}`;
}

export function isNamespacedId(value: string, extensionId: string): boolean {
	const prefix = `${extensionId}/`;
	return (
		value.startsWith(prefix) &&
		LOCAL_ID_PATTERN.test(value.slice(prefix.length))
	);
}
