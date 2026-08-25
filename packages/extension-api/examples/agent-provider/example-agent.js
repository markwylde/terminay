import { defineAgentProvider, jsonlSession } from "@terminay/extension-api";

export const exampleAgentProvider = defineAgentProvider({
  mappingVersion: "0.1",

  matchesForeground(process) {
    return process.executableName === "example-agent";
  },

  async observe(terminal) {
    if (!terminal.capabilities.has("agent-journal")) {
      return { state: "unavailable", reason: "environment-capability-missing" };
    }

    // terminal.tty is an optional host fact, never a path or file capability.
    const ttyDeviceId = terminal.tty?.deviceId;
    const journal = await terminal.observation.files.resolveHomeRelative(
      ".example-agent/sessions/current.jsonl",
      {
      beneath: { homeRelative: ".example-agent/sessions" },
      extension: ".jsonl",
      signal: terminal.signal,
      },
    );
    if (!journal) return { state: "not-bound" };

    const journalPath = await terminal.observation.files.homeRelativePath(journal, {
      beneath: { homeRelative: ".example-agent/sessions" }, signal: terminal.signal,
    });
    if (!journalPath) return { state: "not-bound" };

    const header = await terminal.observation.files.readJsonLine(journal, {
      position: "first",
      maxBytes: 64 * 1024,
      signal: terminal.signal,
    });
    if (!isRecord(header) || header.type !== "session" || typeof header.id !== "string") {
      return { state: "not-bound" };
    }

    const binding = await terminal.bindSession({
      providerSessionId: header.id,
      mappingVersion: "0.1",
      journal,
      fingerprint: {
        kind: "known-home-relative-journal",
        file: journal,
        metadata: ttyDeviceId ? { ttyDeviceId } : undefined,
      },
    });

    return jsonlSession({
      binding,
      source: terminal.observation.files.follow(journal, { signal: terminal.signal }),
      mapRecord,
    });
  },
});

function mapRecord(record, session) {
  if (!isRecord(record)) return;

  if (record.type === "session" || record.type === "session_started") {
    session.publish.sessionStarted({ title: boundedString(record.title, 200) });
  } else if (record.type === "user_message") {
    const turnId = requiredId(record.turnId);
    if (turnId) session.publish.turnStarted({ turnId, promptText: boundedString(record.text, 4_000) });
  } else if (record.type === "tool_started") {
    const toolId = requiredId(record.toolId);
    if (toolId) session.publish.toolStarted({ toolId, name: boundedString(record.toolName, 200) ?? "Tool" });
  } else if (record.type === "approval_requested") {
    const waitId = requiredId(record.requestId);
    if (waitId) session.publish.waitStarted({ waitId, state: "waiting", reason: "Approval requested" });
  } else if (record.type === "turn_completed") {
    session.publish.done({ outcome: "success" });
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value, maximum) {
  return typeof value === "string" ? value.slice(0, maximum) : undefined;
}

function requiredId(value) {
  const id = boundedString(value, 200);
  return id && id.length > 0 ? id : undefined;
}
