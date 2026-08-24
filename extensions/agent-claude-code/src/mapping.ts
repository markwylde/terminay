import { safeAgentString } from "@terminay/extension-api";
import type { AgentLifecyclePublisher, AgentRecordContext } from "@terminay/extension-api";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function content(message: JsonObject): readonly JsonObject[] {
  return Array.isArray(message.content)
    ? message.content.map(object).filter((item): item is JsonObject => item !== undefined)
    : [];
}

function bounded(value: unknown, maximum: number): string | undefined {
  const candidate = safeAgentString(value);
  return candidate !== undefined && candidate.length <= maximum ? candidate : undefined;
}

function id(value: unknown, prefix: string, fallback?: unknown): string | undefined {
  return bounded(value, 512) ?? bounded(fallback, 500)?.replace(/^/u, `${prefix}:`);
}

function model(message: JsonObject): { id: string } | undefined {
  const value = bounded(message.model, 200);
  return value ? { id: value } : undefined;
}

function metadata(message: JsonObject): { model?: { id: string } } {
  const value = model(message);
  return value ? { model: value } : {};
}

/**
 * Claude Code project-session JSONL mapping v0.1. It reads only lifecycle
 * fields and an allowlisted user-text preview. Tool input/output and assistant
 * text never cross the extension boundary.
 */
export function mapClaudeRecord(record: unknown, session: AgentRecordContext): void {
  const envelope = object(record);
  if (!envelope || envelope.isSidechain === true) return;
  const message = object(envelope.message) ?? {};
  const publisher = session.publish;

  if (envelope.type === "permission-mode") {
    publisher.sessionStarted({ title: "Claude Code", ...metadata(message) });
    return;
  }
  if (envelope.type === "ai-title") {
    const title = bounded(envelope.aiTitle, 200);
    if (title) publisher.metadataChanged({ title });
    return;
  }
  if (envelope.type === "user" && message.role === "user" && envelope.isMeta !== true) {
    const results = content(message).filter((item) => item.type === "tool_result");
    if (results.length > 0) {
      for (const item of results) {
        const toolId = id(item.tool_use_id, "tool", envelope.uuid);
        if (toolId) publisher.toolFinished({ toolId, outcome: item.is_error === true ? "error" : "success" });
      }
      return;
    }
    const promptText = userText(message);
    if (promptText === undefined) return;
    const turnId = id(envelope.promptId, "user", envelope.uuid);
    if (turnId) publisher.turnStarted({ turnId, promptText });
    return;
  }
  if (envelope.type === "assistant" && message.role === "assistant") {
    const turnId = id(envelope.uuid, "assistant", envelope.requestId);
    const modelMetadata = metadata(message);
    if (modelMetadata.model) publisher.metadataChanged(modelMetadata);
    if (turnId) publisher.turnStarted({ turnId });
    for (const item of content(message).filter((candidate) => candidate.type === "tool_use")) {
      const toolId = id(item.id, "tool", envelope.uuid);
      const name = bounded(item.name, 200);
      if (!toolId || !name) continue;
      const input = object(item.input) ?? {};
      if (name === "Agent") {
        const childTitle = bounded(input.description, 200) ?? bounded(input.subagent_type, 200);
        const childPrompt = bounded(input.prompt, 4_000);
        publisher.subagentStarted({
          subagentId: toolId,
          parentAgentId: session.binding.providerSessionId,
          ...(childTitle ? { title: childTitle } : {}),
          ...(childPrompt ? { promptText: childPrompt } : {}),
          ...metadata(message),
        });
      } else if (name === "AskUserQuestion") {
        publisher.waitStarted({ waitId: toolId, state: "waiting", reason: "AskUserQuestion" });
      } else {
        publisher.toolStarted({ toolId, name });
      }
    }
    if (message.stop_reason === "end_turn") publisher.done({ outcome: "success" });
    return;
  }
  if (envelope.type === "system" && envelope.subtype === "turn_duration") publisher.done({ outcome: "success" });
}

function userText(message: JsonObject): string | undefined {
  if (typeof message.content === "string") {
    const text = bounded(message.content, 4_000);
    return text && !/^\s*<command-name>/u.test(text) ? text : undefined;
  }
  return content(message)
    .filter((item) => item.type === "text")
    .map((item) => bounded(item.text, 4_000))
    .find((text): text is string => text !== undefined);
}
