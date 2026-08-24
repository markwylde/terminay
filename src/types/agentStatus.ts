/**
 * Provider-neutral agent lifecycle types.
 *
 * Provider drivers normalize their native events into `AgentLifecycleEvent`.
 * `sequence` must increase within one provider session (`provider` +
 * `sessionId` + `activationTerminalSessionId`).
 */

export const AGENT_PROVIDERS = ['codex', 'claude-code', 'cursor', 'omp'] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

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
export type AgentToolOutcome = AgentCompletionOutcome;

export type AgentModelMetadata = {
	/** Provider model identifier, for example `gpt-5.3-codex` or `claude-opus-4-1`. */
	id: string;
	displayName?: string;
	reasoningEffort?: string;
	contextWindowTokens?: number;
};

export type AgentToolStatus = {
	id: string;
	name: string;
	description?: string;
	/** Driver-identified metadata for a tool call that launches a subagent. */
	subagentLaunch?: {
		displayName?: string;
		promptText?: string;
	};
	startedAt: number;
};

type AgentLifecycleEventBase = {
	provider: AgentProvider;
	/** Provider session id for the root agent. */
	sessionId: string;
	/** Terminal in which the root agent (and any in-process subagents) was activated. */
	activationTerminalSessionId: string;
	/** Monotonically increasing within this provider session. */
	sequence: number;
	occurredAt: number;
	/** Provider-reported prompt text; transport boundaries sanitize and bound it. */
	promptText?: string;
	/** Provider-reported model metadata; transport boundaries sanitize and bound it. */
	model?: AgentModelMetadata;
};

type TargetedAgentEvent = {
	/** Defaults to `sessionId`, which targets the root agent. */
	agentId?: string;
};

export type AgentLifecycleEvent =
	| (AgentLifecycleEventBase & {
			kind: 'session.started';
			displayName?: string;
	  })
	| (AgentLifecycleEventBase &
			TargetedAgentEvent & {
				/** Metadata updates preserve the current lifecycle state. */
				kind: 'agent.metadata';
			})
	| (AgentLifecycleEventBase & {
			kind: 'session.stopped';
			reason?: string;
	  })
	| (AgentLifecycleEventBase &
			TargetedAgentEvent & {
				kind: 'turn.started';
				turnId?: string;
			})
	| (AgentLifecycleEventBase &
			TargetedAgentEvent & {
				kind: 'tool.started';
				tool: {
					id: string;
					name: string;
					description?: string;
					subagentLaunch?: {
						displayName?: string;
						promptText?: string;
					};
				};
			})
	| (AgentLifecycleEventBase &
			TargetedAgentEvent & {
				kind: 'tool.finished';
				toolId: string;
				outcome?: AgentToolOutcome;
			})
	| (AgentLifecycleEventBase &
			TargetedAgentEvent & {
				kind: 'wait.started';
				state: 'waiting' | 'blocked';
				reason?: string;
			})
	| (AgentLifecycleEventBase &
			TargetedAgentEvent & {
				kind: 'wait.finished';
			})
	| (AgentLifecycleEventBase &
			TargetedAgentEvent & {
				kind: 'agent.done';
				outcome?: AgentCompletionOutcome;
				summary?: string;
			})
	| (AgentLifecycleEventBase & {
			kind: 'subagent.started';
			subagentId: string;
			parentAgentId?: string;
			displayName?: string;
	  })
	| (AgentLifecycleEventBase & {
			kind: 'subagent.stopped';
			subagentId: string;
			outcome?: AgentCompletionOutcome;
			summary?: string;
	  })
	| (AgentLifecycleEventBase &
			TargetedAgentEvent & {
				kind: 'agent.exited';
				exitCode?: number;
				signal?: string;
			});

type AgentStatusEntryBase = {
	entryId: string;
	kind: AgentEntryKind;
	provider: AgentProvider;
	/** Provider id of this root agent or subagent. */
	agentId: string;
	/** Provider session id of the root agent. */
	sessionId: string;
	activationTerminalSessionId: string;
	displayName?: string;
	promptText?: string;
	model?: AgentModelMetadata;
	state: AgentState;
	stateStartedAt: number;
	updatedAt: number;
	lastEventKind: AgentLifecycleEvent['kind'];
	lastEventSequence: number;
	active: boolean;
	activeTools: readonly AgentToolStatus[];
	currentTurnId?: string;
	waitingReason?: string;
	completionOutcome?: AgentCompletionOutcome;
	summary?: string;
	exitCode?: number;
	exitSignal?: string;
	/**
	 * Presentation state is intentionally independent of the operational
	 * `state`. New attention-worthy lifecycle events set this flag; only an
	 * acknowledgement clears it.
	 */
	unread: boolean;
	acknowledgedAt?: number;
};

export type RootAgentStatusEntry = AgentStatusEntryBase & {
	kind: 'root';
	terminalSessionId: string;
	inProcess: false;
};

export type SubagentStatusEntry = AgentStatusEntryBase & {
	kind: 'subagent';
	/** In-process subagents do not own a separate terminal session. */
	terminalSessionId: null;
	inProcess: true;
	parentAgentId: string;
	parentEntryId: string;
};

export type AgentStatusEntry = RootAgentStatusEntry | SubagentStatusEntry;

export type AgentEventCursor = {
	sequence: number;
	occurredAt: number;
};

export type AgentStatusSnapshot = {
	revision: number;
	entries: Readonly<Record<string, AgentStatusEntry>>;
	/** Last accepted event per normalized provider-session stream. */
	eventCursors: Readonly<Record<string, AgentEventCursor>>;
};

export type AgentStatusListener = (snapshot: AgentStatusSnapshot) => void;

export function isAgentProvider(value: unknown): value is AgentProvider {
	return (
		typeof value === 'string' &&
		(AGENT_PROVIDERS as readonly string[]).includes(value)
	);
}

export function isAgentState(value: unknown): value is AgentState {
	return (
		typeof value === 'string' &&
		(AGENT_STATES as readonly string[]).includes(value)
	);
}
