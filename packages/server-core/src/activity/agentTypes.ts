/**
 * Provider-neutral agent status types owned by Terminay Server.
 *
 * Session sources report bounded snapshots through the Extension API; Server
 * Core reduces each snapshot into these entries. They intentionally contain no
 * Electron, renderer, provider journal, or provider configuration details.
 */

/** A bounded, manifest-owned session source id: `<extensionId>/<local-id>`. */
export type AgentProvider = string;

export const AGENT_STATES = [
	'working',
	'waiting',
	'blocked',
	'done',
	'idle',
] as const;
export type AgentState = (typeof AGENT_STATES)[number];

export type AgentEntryKind = 'root' | 'subagent';
export type AgentCompletionOutcome = 'success' | 'error' | 'cancelled';

export interface AgentModelMetadata {
	readonly id: string;
	readonly displayName?: string;
}

export interface AgentToolStatus {
	readonly id: string;
	readonly name: string;
	readonly startedAt: number;
}

interface AgentStatusEntryBase {
	readonly entryId: string;
	readonly kind: AgentEntryKind;
	/** The session source that reported the entry. */
	readonly provider: AgentProvider;
	/** Harness id the source declared, e.g. `example-cli`. */
	readonly harness: string;
	/** Display name the source declared for `harness`. */
	readonly harnessDisplayName?: string;
	/** Same as `harnessDisplayName`; the label an untitled root uses. */
	readonly providerDisplayName?: string;
	readonly agentId: string;
	readonly sessionId: string;
	/**
	 * Terminal whose process tree owns the session, or `null` for an external
	 * session no terminal on this server owns.
	 */
	readonly activationTerminalSessionId: string | null;
	/** True when no terminal on this server owns the session. */
	readonly external: boolean;
	/** Projects the session belongs to: by directory, worktree, or terminal. */
	readonly projectIds: readonly string[];
	readonly displayName?: string;
	readonly model?: AgentModelMetadata;
	readonly state: AgentState;
	readonly stateStartedAt: number;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly active: boolean;
	readonly activeTools: readonly AgentToolStatus[];
	readonly waitingReason?: string;
	readonly completionOutcome?: AgentCompletionOutcome;
	/** Bounded error text of a failed turn. */
	readonly summary?: string;
	readonly unread: boolean;
	readonly acknowledgedAt?: number;
}

export type RootAgentStatusEntry = AgentStatusEntryBase & {
	readonly kind: 'root';
	/** `null` for an external session. */
	readonly terminalSessionId: string | null;
	readonly inProcess: false;
	/** Subagents the source reports as still running. */
	readonly openSubagents: number;
};

export type SubagentStatusEntry = AgentStatusEntryBase & {
	readonly kind: 'subagent';
	readonly terminalSessionId: null;
	readonly inProcess: true;
	readonly parentAgentId: string;
	readonly parentEntryId: string;
};

export type AgentStatusEntry = RootAgentStatusEntry | SubagentStatusEntry;

export interface AgentStatusSnapshot {
	readonly revision: number;
	readonly entries: Readonly<Record<string, AgentStatusEntry>>;
	/** Ephemeral id of the emitting Terminay process. Absent only on empty
	 * store-internal snapshots before the service stamps its boot identity. */
	readonly processInstanceId?: string;
}
export type AgentStatusListener = (snapshot: AgentStatusSnapshot) => void;

const EXTENSION_AGENT_PROVIDER_ID =
	/^[a-z0-9](?:[a-z0-9.-]{1,126}[a-z0-9])?\/[a-z][a-z0-9-]{0,63}$/u;

export function isExtensionAgentProvider(
	value: unknown,
): value is AgentProvider {
	return (
		typeof value === 'string' &&
		value.length <= 192 &&
		EXTENSION_AGENT_PROVIDER_ID.test(value)
	);
}

export function isAgentProvider(value: unknown): value is AgentProvider {
	return isExtensionAgentProvider(value);
}

export function isAgentState(value: unknown): value is AgentState {
	return (
		typeof value === 'string' &&
		(AGENT_STATES as readonly string[]).includes(value)
	);
}
