import type { AgentLifecycleEvent, AgentModelMetadata, AgentProvider } from "./agentTypes.js";

export interface AgentDriverContext {
  readonly activationTerminalSessionId: string;
  readonly sequence: number;
  readonly occurredAt?: number;
  readonly providerSessionId?: string;
}

export interface AgentJournalSession {
  readonly providerSessionId: string;
  readonly providerVersion?: string;
}

/** A driver is one provider journal schema at one mapping version. */
export interface AgentDriver {
  readonly provider: AgentProvider;
  readonly mappingVersion: string;
  readonly displayName: string;
  inspectSession(record: unknown): AgentJournalSession | null;
  normalize(record: unknown, context: AgentDriverContext): AgentLifecycleEvent | readonly AgentLifecycleEvent[] | null;
}

export interface ResolvedAgentDriver {
  readonly driver: AgentDriver;
  readonly requestedVersion?: string;
  readonly mappingVersion: string;
}

export interface AgentDriverRegistry {
  readonly drivers: readonly AgentDriver[];
  resolve(provider: string, providerVersion?: string): ResolvedAgentDriver | undefined;
  inspectSession(provider: string, record: unknown): { readonly driver: AgentDriver; readonly session: AgentJournalSession } | null;
  normalize(provider: string, providerVersion: string | undefined, record: unknown, context: AgentDriverContext): AgentLifecycleEvent | readonly AgentLifecycleEvent[] | null;
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function boundedString(limit: number, ...values: unknown[]): string | undefined {
  const value = values.find((candidate) => typeof candidate === "string" && candidate.length > 0);
  return typeof value === "string" ? value.slice(0, limit) : undefined;
}

function timestamp(record: JsonObject, fallback: number): number {
  if (typeof record.timestamp !== "string") return fallback;
  const parsed = Date.parse(record.timestamp);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function model(payload: JsonObject): AgentModelMetadata | undefined {
  const id = boundedString(200, payload.model);
  return id === undefined ? undefined : {
    id,
    ...(boundedString(100, payload.effort, payload.reasoning_effort) === undefined ? {} : { reasoningEffort: boundedString(100, payload.effort, payload.reasoning_effort) }),
  };
}

function base(context: AgentDriverContext, record: JsonObject, payload: JsonObject) {
  const sessionId = context.providerSessionId;
  if (!sessionId) return null;
  return {
    provider: "codex" as const,
    sessionId,
    activationTerminalSessionId: context.activationTerminalSessionId,
    sequence: context.sequence,
    occurredAt: timestamp(record, context.occurredAt ?? Date.now()),
    ...(model(payload) === undefined ? {} : { model: model(payload) }),
  };
}

function outcome(payload: JsonObject): "success" | "error" | "cancelled" {
  const reason = boundedString(100, payload.reason, payload.status)?.toLowerCase();
  if (reason?.includes("cancel") || reason?.includes("abort")) return "cancelled";
  if (payload.error !== undefined || reason?.includes("error") || reason?.includes("fail")) return "error";
  return "success";
}

function toolFields(payload: JsonObject, fallbackName?: string): { readonly id: string; readonly name: string } | null {
  const item = object(payload.item);
  const id = boundedString(512, payload.call_id, payload.id, item?.call_id, item?.id);
  const name = boundedString(200, payload.tool_name, payload.name, item?.name, item?.type, fallbackName);
  return id && name ? { id, name } : null;
}

function codexPromptText(value: unknown): string | undefined {
  const text = boundedString(4_000, value);
  // Codex persists this model-context marker through both historical user
  // message shapes. It is lifecycle guidance, not text authored by the user.
  return text === undefined || /^\s*<turn_aborted>[\s\S]*<\/turn_aborted>\s*$/u.test(text)
    ? undefined
    : text;
}

function codexCompletedUserMessage(payload: JsonObject): string | undefined {
  const item = object(payload.item);
  if (payload.type !== "item_completed" || item?.type !== "UserMessage" || !Array.isArray(item.content)) return undefined;
  const text = item.content
    .map(object)
    .filter((item): item is JsonObject => item?.type === "text")
    .map((item) => codexPromptText(item.text))
    .filter((item): item is string => item !== undefined)
    .join("")
    .slice(0, 4_000);
  return text || undefined;
}

function codexReceivers(item: JsonObject): readonly { readonly id: string; readonly displayName?: string }[] {
  const named = Array.isArray(item.receiver_agents) ? item.receiver_agents.map(object).filter((value): value is JsonObject => value !== undefined) : [];
  const byId = new Map<string, { readonly id: string; readonly displayName?: string }>();
  for (const receiver of named) {
    const id = boundedString(512, receiver.thread_id);
    const displayName = boundedString(200, receiver.agent_nickname);
    if (id) byId.set(id, { id, ...(displayName ? { displayName } : {}) });
  }
  if (Array.isArray(item.receiver_thread_ids)) {
    for (const value of item.receiver_thread_ids) {
      const id = boundedString(512, value);
      if (id && !byId.has(id)) byId.set(id, { id });
    }
  }
  return [...byId.values()];
}

function codexAgentDisplayName(payload: JsonObject): string | undefined {
  const path = boundedString(1_000, payload.agent_path);
  return boundedString(
    200,
    payload.new_agent_nickname,
    payload.receiver_agent_nickname,
    payload.agent_nickname,
    payload.new_agent_role,
    payload.receiver_agent_role,
    payload.agent_role,
    path?.split(/[\\/]/u).filter(Boolean).pop(),
  );
}

function codexAgentOutcome(status: unknown): "success" | "error" | "cancelled" | undefined {
  const name = typeof status === "string"
    ? status.toLowerCase()
    : Object.keys(object(status) ?? {})[0]?.toLowerCase();
  if (name === "completed" || name === "shutdown") return "success";
  if (name === "errored" || name === "not_found") return "error";
  if (name === "interrupted") return "cancelled";
  return undefined;
}

/**
 * Codex rollout JSONL mapping v0.1.
 *
 * Deliberately read only the envelope and allowlisted lifecycle fields. A
 * bounded user-message preview supports the existing agent label; command
 * arguments, model output, and tool results are never copied or logged.
 */
export const codexV01Driver: AgentDriver = Object.freeze({
  provider: "codex",
  mappingVersion: "0.1",
  displayName: "Codex",
  inspectSession(record: unknown): AgentJournalSession | null {
    const envelope = object(record);
    const payload = object(envelope?.payload);
    if (envelope?.type !== "session_meta" || !payload) return null;
    const providerSessionId = boundedString(512, payload.id, payload.session_id);
    if (!providerSessionId) return null;
    return {
      providerSessionId,
      ...(boundedString(100, payload.cli_version) === undefined ? {} : { providerVersion: boundedString(100, payload.cli_version) }),
    };
  },
  normalize(record: unknown, context: AgentDriverContext): AgentLifecycleEvent | readonly AgentLifecycleEvent[] | null {
    const envelope = object(record);
    const payload = object(envelope?.payload);
    if (!envelope || !payload) return null;
    const common = base(context, envelope, payload);
    if (!common) return null;

    if (envelope.type === "session_meta") {
      return { ...common, kind: "session.started", displayName: "Codex" };
    }
    if (envelope.type === "turn_context") return { ...common, kind: "turn.started" };
    if (envelope.type === "event_msg") {
      const eventType = boundedString(100, payload.type);
      if (eventType === "task_started" || eventType === "turn_started") {
        return { ...common, kind: "turn.started", turnId: boundedString(512, payload.turn_id) };
      }
      if (eventType === "user_message") {
        const promptText = codexPromptText(payload.message);
        const turnId = boundedString(512, payload.turn_id);
        return promptText === undefined ? null : { ...common, kind: "turn.started", promptText, ...(turnId ? { turnId } : {}) };
      }
      if (eventType === "item_completed") {
        const promptText = codexCompletedUserMessage(payload);
        if (promptText !== undefined) return { ...common, kind: "turn.started", promptText };
        const item = object(payload.item);
        if (item?.type !== "CollabAgentToolCall") return null;
        const tool = boundedString(100, item.tool);
        if (tool === "spawn_agent") {
          return codexReceivers(item).map((receiver) => ({
            ...common,
            ...(model(item) === undefined ? {} : { model: model(item) }),
            kind: "subagent.started" as const,
            subagentId: receiver.id,
            parentAgentId: boundedString(512, item.sender_thread_id),
            displayName: receiver.displayName,
            promptText: boundedString(4_000, item.prompt),
          }));
        }
        const states = object(item.agents_states);
        if (tool === "wait" && states) {
          return Object.entries(states).flatMap(([agentId, status]) => {
            const subagentId = boundedString(512, agentId);
            const agentOutcome = codexAgentOutcome(status);
            return subagentId && agentOutcome ? [{ ...common, kind: "agent.done" as const, agentId: subagentId, outcome: agentOutcome }] : [];
          });
        }
        return null;
      }
      if (eventType === "task_complete" || eventType === "turn_complete") {
        return { ...common, kind: "agent.done", outcome: outcome(payload) };
      }
      if (eventType === "turn_aborted") return { ...common, kind: "agent.done", outcome: "cancelled" };
      if (eventType === "error") return { ...common, kind: "agent.done", outcome: "error" };
      if (eventType === "shutdown_complete") return { ...common, kind: "session.stopped", reason: "shutdown" };
      if (eventType === "exec_approval_request" || eventType === "apply_patch_approval_request" || eventType === "request_permissions" || eventType === "request_user_input" || eventType === "elicitation_request") {
        return { ...common, kind: "wait.started", state: "waiting", reason: eventType };
      }
      if (eventType === "collab_agent_spawn_end") {
        const subagentId = boundedString(512, payload.new_thread_id, payload.agent_id, payload.thread_id, payload.receiver_thread_id);
        return subagentId ? {
          ...common, kind: "subagent.started", subagentId,
          parentAgentId: boundedString(512, payload.sender_thread_id, payload.parent_agent_id),
          displayName: codexAgentDisplayName(payload),
          promptText: boundedString(4_000, payload.prompt),
        } : null;
      }
      if (eventType === "collab_agent_interaction_end" || eventType === "collab_resume_end") {
        const subagentId = boundedString(512, payload.receiver_thread_id, payload.agent_id, payload.thread_id);
        const agentOutcome = codexAgentOutcome(payload.status);
        return subagentId
          ? agentOutcome === undefined
            ? { ...common, kind: "subagent.started", subagentId, displayName: codexAgentDisplayName(payload), promptText: boundedString(4_000, payload.prompt) }
            : { ...common, kind: "agent.done", agentId: subagentId, outcome: agentOutcome }
          : null;
      }
      if (eventType === "collab_close_end" || eventType === "collab_agent_shutdown") {
        const subagentId = boundedString(512, payload.receiver_thread_id, payload.agent_id, payload.thread_id);
        return subagentId ? { ...common, kind: "subagent.stopped", subagentId, outcome: codexAgentOutcome(payload.status) ?? outcome(payload) } : null;
      }
      if (eventType === "sub_agent_activity") {
        const subagentId = boundedString(512, payload.agent_thread_id);
        const activityKind = boundedString(100, payload.kind);
        if (!subagentId || !activityKind) return null;
        const path = boundedString(1_000, payload.agent_path);
        const displayName = path?.split(/[\\/]/u).filter(Boolean).pop()?.slice(0, 200);
        return activityKind === "started" || activityKind === "interacted"
          ? { ...common, kind: "subagent.started", subagentId, ...(displayName ? { displayName } : {}) }
          : activityKind === "interrupted" || activityKind === "completed"
            ? { ...common, kind: "agent.done", agentId: subagentId, outcome: activityKind === "interrupted" ? "cancelled" : outcome(payload) }
            : activityKind === "stopped" || activityKind === "shutdown"
              ? { ...common, kind: "subagent.stopped", subagentId, outcome: outcome(payload) }
            : null;
      }
      if (eventType?.endsWith("_begin")) {
        const tool = toolFields(payload, eventType.slice(0, -6));
        return tool === null ? null : { ...common, kind: "tool.started", tool };
      }
      if (eventType?.endsWith("_end")) {
        const tool = toolFields(payload, eventType.slice(0, -4));
        return tool === null ? null : { ...common, kind: "tool.finished", toolId: tool.id, outcome: outcome(payload) };
      }
      return null;
    }
    if (envelope.type === "response_item") {
      const itemType = boundedString(100, payload.type);
      if (itemType === "custom_tool_call" || itemType === "function_call" || itemType === "local_shell_call") {
        const tool = toolFields(payload);
        return tool === null ? null : { ...common, kind: "tool.started", tool };
      }
      if (itemType === "custom_tool_call_output" || itemType === "function_call_output" || itemType === "local_shell_call_output") {
        const id = boundedString(512, payload.call_id, payload.id);
        return id ? { ...common, kind: "tool.finished", toolId: id, outcome: outcome(payload) } : null;
      }
    }
    return null;
  },
});

function versionTuple(value: string | undefined): readonly number[] | undefined {
  if (value === undefined) return undefined;
  const match = /^(\d+)(?:\.(\d+))?/u.exec(value.trim().replace(/^v/u, ""));
  return match ? [Number(match[1]), Number(match[2] ?? 0)] : undefined;
}

function compareVersion(left: string, right: string): number {
  const a = versionTuple(left) ?? [0, 0];
  const b = versionTuple(right) ?? [0, 0];
  return (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0);
}

export function createAgentDriverRegistry(drivers: readonly AgentDriver[] = [codexV01Driver]): AgentDriverRegistry {
  const ordered = [...drivers].sort((left, right) => left.provider.localeCompare(right.provider) || compareVersion(left.mappingVersion, right.mappingVersion));
  const resolve = (provider: string, providerVersion?: string): ResolvedAgentDriver | undefined => {
    const candidates = ordered.filter((driver) => driver.provider === provider);
    if (candidates.length === 0) return undefined;
    const target = versionTuple(providerVersion);
    const driver = target === undefined
      ? candidates[candidates.length - 1]
      : [...candidates].reverse().find((candidate) => compareVersion(candidate.mappingVersion, providerVersion ?? "") <= 0) ?? candidates[0];
    return driver ? { driver, requestedVersion: providerVersion, mappingVersion: driver.mappingVersion } : undefined;
  };
  return Object.freeze({
    drivers: Object.freeze(ordered),
    resolve,
    inspectSession(provider: string, record: unknown) {
      for (const driver of [...ordered].reverse()) {
        if (driver.provider !== provider) continue;
        const session = driver.inspectSession(record);
        if (session) return { driver, session };
      }
      return null;
    },
    normalize(provider: string, providerVersion: string | undefined, record: unknown, context: AgentDriverContext) {
      return resolve(provider, providerVersion)?.driver.normalize(record, context) ?? null;
    },
  });
}

export const agentDriverRegistry = createAgentDriverRegistry();
