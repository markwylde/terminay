import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { AgentLifecycleEvent, AgentModelMetadata, AgentProvider } from "./agentTypes.js";
import {
  CLAUDE_CODE_MANAGED_HOOK_EVENTS,
  CODEX_MANAGED_HOOK_EVENTS,
  type ManagedHookOptions,
  type ManagedHookReconciler,
  type ManagedHookStatus,
  claudeCodeManagedHookReconciler,
  codexManagedHookReconciler,
} from "./managedHooks.js";

export interface AgentDriverContext {
  readonly activationTerminalSessionId: string;
  readonly sequence: number;
  readonly occurredAt?: number;
  readonly providerSessionId?: string;
}

export interface AgentDriver {
  readonly provider: AgentProvider;
  readonly displayName: string;
  readonly hooks: ManagedHookReconciler;
  normalize(nativePayload: unknown, context: AgentDriverContext): AgentLifecycleEvent | null;
}

export interface AgentDriverRegistry {
  readonly drivers: readonly AgentDriver[];
  get(provider: string): AgentDriver | undefined;
  normalize(provider: string, nativePayload: unknown, context: AgentDriverContext): AgentLifecycleEvent | null;
  normalizeAsync(provider: string, nativePayload: unknown, context: AgentDriverContext): Promise<AgentLifecycleEvent | null>;
  hookStatus(provider: string, options?: ManagedHookOptions): Promise<ManagedHookStatus>;
  reconcileHooks(request: { readonly provider?: AgentProvider; readonly action: "install" | "uninstall" | "status"; readonly options?: ManagedHookOptions }): Promise<{ readonly statuses: readonly ManagedHookStatus[]; readonly ok: boolean }>;
}

const INTERACTIVE_TOOLS = new Set(["askuserquestion", "request_user_input", "requestuserinput"]);
const CODEX_EVENTS = new Set(CODEX_MANAGED_HOOK_EVENTS.map(({ eventName }) => canonical(eventName)));
const CLAUDE_EVENTS = new Set(CLAUDE_CODE_MANAGED_HOOK_EVENTS.map(({ eventName }) => canonical(eventName)));
const MAX_CODEX_TRANSCRIPT_BYTES = 1_048_576;

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(max: number, ...values: unknown[]): string | undefined {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim().slice(0, max);
  return undefined;
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function canonical(value: string): string { return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase(); }

function modelValue(value: unknown): AgentModelMetadata | undefined {
  if (typeof value === "string" && value.trim()) return { id: value.trim().slice(0, 200) };
  if (!plainObject(value)) return undefined;
  const id = stringValue(200, value.id, value.model_id, value.modelId, value.name);
  if (!id) return undefined;
  const contextWindowTokens = numberValue(value.context_window_tokens, value.contextWindowTokens);
  return {
    id,
    ...(stringValue(200, value.display_name, value.displayName) === undefined ? {} : { displayName: stringValue(200, value.display_name, value.displayName) }),
    ...(stringValue(100, value.reasoning_effort, value.reasoningEffort) === undefined ? {} : { reasoningEffort: stringValue(100, value.reasoning_effort, value.reasoningEffort) }),
    ...(contextWindowTokens === undefined || contextWindowTokens < 0 ? {} : { contextWindowTokens }),
  };
}

function nestedString(value: unknown, key: string): string | undefined { return plainObject(value) ? stringValue(512, value[key]) : undefined; }

function normalizeNative(provider: AgentProvider, nativePayload: unknown, context: AgentDriverContext, supported: ReadonlySet<string>): AgentLifecycleEvent | null {
  if (!plainObject(nativePayload)) return null;
  const eventName = stringValue(100, nativePayload.hook_event_name, nativePayload.hookEventName, nativePayload.event_name, nativePayload.event, nativePayload.type);
  if (!eventName || !supported.has(canonical(eventName))) return null;
  const sessionId = stringValue(512, nativePayload.session_id, nativePayload.sessionId, nativePayload.thread_id, nativePayload.threadId, context.providerSessionId) ?? context.activationTerminalSessionId;
  const rawAgentId = stringValue(512, nativePayload.agent_id, nativePayload.agentId);
  const agentId = rawAgentId !== undefined && rawAgentId !== sessionId ? rawAgentId : undefined;
  const subagentId = stringValue(512, nativePayload.subagent_id, nativePayload.subagentId, nativePayload.agent_id, nativePayload.agentId);
  const toolName = stringValue(200, nativePayload.tool_name, nativePayload.toolName, nestedString(nativePayload.tool, "name"));
  const toolId = stringValue(512, nativePayload.tool_use_id, nativePayload.toolUseId, nativePayload.tool_call_id, nativePayload.toolCallId, nestedString(nativePayload.tool, "id")) ?? toolName;
  const reason = stringValue(4_000, nativePayload.reason, nativePayload.message, nativePayload.error);
  const summary = stringValue(8_000, nativePayload.last_assistant_message, nativePayload.lastAssistantMessage, nativePayload.summary);
  const base = {
    provider,
    sessionId,
    activationTerminalSessionId: context.activationTerminalSessionId,
    sequence: context.sequence,
    occurredAt: context.occurredAt ?? Date.now(),
    ...(stringValue(4_000, nativePayload.prompt, nativePayload.prompt_text, nativePayload.promptText, nativePayload.user_prompt, nativePayload.userPrompt) === undefined ? {} : { promptText: stringValue(4_000, nativePayload.prompt, nativePayload.prompt_text, nativePayload.promptText, nativePayload.user_prompt, nativePayload.userPrompt) }),
    ...(modelValue(nativePayload.model) === undefined ? {} : { model: modelValue(nativePayload.model) }),
  } as const;
  const target = agentId === undefined ? {} : { agentId };
  const key = canonical(eventName);
  if (key === "sessionstart" || key === "sessionstarted") return { ...base, kind: "session.started", displayName: stringValue(200, nativePayload.display_name, nativePayload.displayName) };
  if (key === "sessionend" || key === "sessionstop" || key === "sessionstopped") return { ...base, kind: "session.stopped", reason };
  if (key === "subagentstart" || key === "subagentstarted") {
    if (!subagentId) return null;
    return { ...base, kind: "subagent.started", subagentId, parentAgentId: stringValue(512, nativePayload.parent_agent_id, nativePayload.parentAgentId), displayName: stringValue(200, nativePayload.display_name, nativePayload.displayName, nativePayload.task_name, nativePayload.taskName, nativePayload.agent_type, nativePayload.agentType) };
  }
  if (key === "subagentstop" || key === "subagentstopped") {
    if (!subagentId) return null;
    return { ...base, kind: "subagent.stopped", subagentId, outcome: completionOutcome(nativePayload), summary };
  }
  if (key === "permissionrequest" || key === "requestuserinput" || key === "askuserquestion" || (toolName !== undefined && INTERACTIVE_TOOLS.has(canonical(toolName)))) return { ...base, ...target, kind: "wait.started", state: "waiting", reason: reason ?? toolName };
  if (key === "userpromptsubmit" || key === "prompt" || key === "promptsubmit" || key === "turnstart" || key === "turnstarted") return { ...base, ...target, kind: "turn.started", turnId: stringValue(512, nativePayload.turn_id, nativePayload.turnId) };
  if (key === "pretooluse" || key === "toolstart" || key === "toolstarted" || key === "beforetool") {
    if (!toolName) return null;
    const launch = subagentLaunch(toolName, nativePayload.tool_input);
    return { ...base, ...target, kind: "tool.started", tool: { id: toolId ?? toolName, name: toolName, ...(describeTool(nativePayload.tool_input) === undefined ? {} : { description: describeTool(nativePayload.tool_input) }), ...(launch === undefined ? {} : { subagentLaunch: launch }) } };
  }
  if (key === "posttooluse" || key === "posttoolusefailure" || key === "toolfinish" || key === "toolfinished" || key === "aftertool") {
    if (!toolId) return null;
    return { ...base, ...target, kind: "tool.finished", toolId, outcome: key.includes("failure") ? "error" : "success" };
  }
  if (key === "stop" || key === "stopfailure" || key === "turndone" || key === "turncompleted") return { ...base, ...target, kind: "agent.done", outcome: completionOutcome(nativePayload), summary };
  if (key === "agentexit" || key === "agentexited") return { ...base, ...target, kind: "agent.exited", exitCode: numberValue(nativePayload.exit_code, nativePayload.exitCode), signal: stringValue(100, nativePayload.signal) };
  return null;
}

function completionOutcome(payload: Record<string, unknown>): "success" | "error" | "cancelled" {
  const key = canonical(stringValue(100, payload.hook_event_name, payload.event, payload.type) ?? "");
  if (key.includes("failure") || payload.error !== undefined || payload.success === false) return "error";
  if (payload.cancelled === true || payload.canceled === true) return "cancelled";
  return "success";
}

function describeTool(value: unknown): string | undefined {
  if (typeof value === "string") return value.slice(0, 500);
  if (!plainObject(value)) return undefined;
  return stringValue(500, value.command, value.cmd, value.file_path, value.path, value.query, value.message, value.prompt, value.description);
}

function subagentLaunch(toolName: string, input: unknown): { readonly displayName?: string; readonly promptText?: string } | undefined {
  const key = canonical(toolName);
  if (key !== "agent" && key !== "task" && key !== "spawnagent" && !key.endsWith("spawnagent")) return undefined;
  if (!plainObject(input)) return {};
  return {
    ...(stringValue(200, input.task_name, input.taskName, input.name, input.agent_type, input.agentType) === undefined ? {} : { displayName: stringValue(200, input.task_name, input.taskName, input.name, input.agent_type, input.agentType) }),
    ...(stringValue(4_000, input.message, input.prompt, input.description, input.task) === undefined ? {} : { promptText: stringValue(4_000, input.message, input.prompt, input.description, input.task) }),
  };
}

async function codexSubagentDisplayName(nativePayload: unknown): Promise<string | undefined> {
  if (!plainObject(nativePayload) || typeof nativePayload.transcript_path !== "string" || nativePayload.transcript_path.length === 0) return undefined;
  try {
    const transcript = await readFile(nativePayload.transcript_path, "utf8");
    if (Buffer.byteLength(transcript, "utf8") > MAX_CODEX_TRANSCRIPT_BYTES) return undefined;
    for (const line of transcript.split(/\r?\n/u)) {
      if (!line.trim()) continue;
      let record: unknown;
      try { record = JSON.parse(line); } catch { continue; }
      if (!plainObject(record) || record.type !== "session_meta" || !plainObject(record.payload)) continue;
      const source = record.payload.source;
      const subagent = plainObject(source) && plainObject(source.subagent) ? source.subagent : undefined;
      const spawn = subagent !== undefined && plainObject(subagent.thread_spawn) ? subagent.thread_spawn : undefined;
      const agentPath = spawn === undefined ? undefined : stringValue(512, spawn.agent_path);
      if (!agentPath) continue;
      const name = basename(agentPath).trim();
      if (name && name !== "." && name !== "/") return name.slice(0, 200);
    }
  } catch {
    // Optional native metadata must not reject a provider hook or expose a transcript.
  }
  return undefined;
}

async function enrichBuiltInCodexEvent(event: AgentLifecycleEvent | null, nativePayload: unknown): Promise<AgentLifecycleEvent | null> {
  if (event?.kind !== "subagent.started") return event;
  const displayName = await codexSubagentDisplayName(nativePayload);
  return displayName === undefined ? event : { ...event, displayName };
}

const codexDriver: AgentDriver = { provider: "codex", displayName: "Codex", hooks: codexManagedHookReconciler, normalize: (payload, context) => normalizeNative("codex", payload, context, CODEX_EVENTS) };
const claudeCodeDriver: AgentDriver = { provider: "claude-code", displayName: "Claude Code", hooks: claudeCodeManagedHookReconciler, normalize: (payload, context) => normalizeNative("claude-code", payload, context, CLAUDE_EVENTS) };

export function createAgentDriverRegistry(drivers: readonly AgentDriver[] = [codexDriver, claudeCodeDriver]): AgentDriverRegistry {
  const byProvider = new Map(drivers.map((driver) => [driver.provider, driver] as const));
  return {
    drivers,
    get: (provider) => byProvider.get(provider as AgentProvider),
    normalize: (provider, payload, context) => byProvider.get(provider as AgentProvider)?.normalize(payload, context) ?? null,
    normalizeAsync: async (provider, payload, context) => {
      const driver = byProvider.get(provider as AgentProvider);
      if (driver === undefined) return null;
      // A composed server may deliberately replace the built-in Codex driver
      // (for example to resolve a provider runtime from its own sealed
      // payload). That driver remains the only normalizer for its provider;
      // transcript enrichment is an optional built-in Codex detail, never a
      // reason to bypass the composed authority.
      const event = driver.normalize(payload, context);
      return provider === "codex" && driver === codexDriver
        ? enrichBuiltInCodexEvent(event, payload)
        : event;
    },
    hookStatus: async (provider, options) => {
      const driver = byProvider.get(provider as AgentProvider);
      if (!driver) throw new Error(`Unknown agent provider: ${provider}`);
      return driver.hooks.status(options);
    },
    reconcileHooks: async (request) => {
      const selected = request.provider ? drivers.filter((driver) => driver.provider === request.provider) : [...drivers];
      if (selected.length === 0) throw new Error(`Unknown agent provider: ${request.provider}`);
      const statuses = await Promise.all(selected.map((driver) => request.action === "install" ? driver.hooks.install(request.options) : request.action === "uninstall" ? driver.hooks.uninstall(request.options) : driver.hooks.status(request.options)));
      return { statuses, ok: statuses.every((status) => request.action === "install" ? status.state === "installed" : request.action === "uninstall" ? status.state === "not-installed" : status.state !== "error") };
    },
  };
}

export const agentDriverRegistry = createAgentDriverRegistry();
export { codexDriver, claudeCodeDriver };
export type { ManagedHookOptions, ManagedHookStatus };
