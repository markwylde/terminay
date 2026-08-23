/**
 * Provider-neutral agent lifecycle types owned by Terminay Server.
 *
 * Native provider payloads must be normalized before they cross the server
 * boundary. These types intentionally contain no Electron, renderer, or
 * provider-specific configuration details.
 */

export const AGENT_PROVIDERS = ["codex", "claude-code", "omp"] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export const AGENT_STATES = ["working", "waiting", "blocked", "done", "idle"] as const;
export type AgentState = (typeof AGENT_STATES)[number];

export type AgentEntryKind = "root" | "subagent";
export type AgentCompletionOutcome = "success" | "error" | "cancelled";
export type AgentToolOutcome = AgentCompletionOutcome;

export interface AgentModelMetadata {
  readonly id: string;
  readonly displayName?: string;
  readonly reasoningEffort?: string;
  readonly contextWindowTokens?: number;
}

export interface AgentToolStatus {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly subagentLaunch?: { readonly displayName?: string; readonly promptText?: string };
  readonly startedAt: number;
}

interface AgentLifecycleEventBase {
  readonly provider: AgentProvider;
  readonly sessionId: string;
  readonly activationTerminalSessionId: string;
  readonly sequence: number;
  readonly occurredAt: number;
  readonly promptText?: string;
  readonly model?: AgentModelMetadata;
}

interface TargetedAgentEvent { readonly agentId?: string }

export type AgentLifecycleEvent =
  | (AgentLifecycleEventBase & { readonly kind: "session.started"; readonly displayName?: string })
  /** Updates bounded provider metadata without changing lifecycle state. */
  | (AgentLifecycleEventBase & TargetedAgentEvent & { readonly kind: "agent.metadata" })
  | (AgentLifecycleEventBase & { readonly kind: "session.stopped"; readonly reason?: string })
  | (AgentLifecycleEventBase & TargetedAgentEvent & { readonly kind: "turn.started"; readonly turnId?: string })
  | (AgentLifecycleEventBase & TargetedAgentEvent & { readonly kind: "tool.started"; readonly tool: { readonly id: string; readonly name: string; readonly description?: string; readonly subagentLaunch?: { readonly displayName?: string; readonly promptText?: string } } })
  | (AgentLifecycleEventBase & TargetedAgentEvent & { readonly kind: "tool.finished"; readonly toolId: string; readonly outcome?: AgentToolOutcome })
  | (AgentLifecycleEventBase & TargetedAgentEvent & { readonly kind: "wait.started"; readonly state: "waiting" | "blocked"; readonly reason?: string })
  | (AgentLifecycleEventBase & TargetedAgentEvent & { readonly kind: "wait.finished" })
  | (AgentLifecycleEventBase & TargetedAgentEvent & { readonly kind: "agent.done"; readonly outcome?: AgentCompletionOutcome; readonly summary?: string })
  | (AgentLifecycleEventBase & { readonly kind: "subagent.started"; readonly subagentId: string; readonly parentAgentId?: string; readonly displayName?: string })
  | (AgentLifecycleEventBase & { readonly kind: "subagent.stopped"; readonly subagentId: string; readonly outcome?: AgentCompletionOutcome; readonly summary?: string })
  | (AgentLifecycleEventBase & TargetedAgentEvent & { readonly kind: "agent.exited"; readonly exitCode?: number; readonly signal?: string });

interface AgentStatusEntryBase {
  readonly entryId: string;
  readonly kind: AgentEntryKind;
  readonly provider: AgentProvider;
  readonly agentId: string;
  readonly sessionId: string;
  readonly activationTerminalSessionId: string;
  readonly displayName?: string;
  readonly promptText?: string;
  readonly model?: AgentModelMetadata;
  readonly state: AgentState;
  readonly stateStartedAt: number;
  readonly updatedAt: number;
  readonly lastEventKind: AgentLifecycleEvent["kind"];
  readonly lastEventSequence: number;
  readonly active: boolean;
  readonly activeTools: readonly AgentToolStatus[];
  readonly currentTurnId?: string;
  readonly waitingReason?: string;
  readonly completionOutcome?: AgentCompletionOutcome;
  readonly summary?: string;
  readonly exitCode?: number;
  readonly exitSignal?: string;
  readonly unread: boolean;
  readonly acknowledgedAt?: number;
}

export type RootAgentStatusEntry = AgentStatusEntryBase & {
  readonly kind: "root";
  readonly terminalSessionId: string;
  readonly inProcess: false;
};

export type SubagentStatusEntry = AgentStatusEntryBase & {
  readonly kind: "subagent";
  readonly terminalSessionId: null;
  readonly inProcess: true;
  readonly parentAgentId: string;
  readonly parentEntryId: string;
};

export type AgentStatusEntry = RootAgentStatusEntry | SubagentStatusEntry;

export interface AgentEventCursor { readonly sequence: number; readonly occurredAt: number }
export interface AgentStatusSnapshot {
  readonly revision: number;
  readonly entries: Readonly<Record<string, AgentStatusEntry>>;
  readonly eventCursors: Readonly<Record<string, AgentEventCursor>>;
}
export type AgentStatusListener = (snapshot: AgentStatusSnapshot) => void;

export function isAgentProvider(value: unknown): value is AgentProvider {
  return typeof value === "string" && (AGENT_PROVIDERS as readonly string[]).includes(value);
}

export function isAgentState(value: unknown): value is AgentState {
  return typeof value === "string" && (AGENT_STATES as readonly string[]).includes(value);
}
