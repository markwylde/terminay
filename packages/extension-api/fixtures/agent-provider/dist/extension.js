import { defineAgentProvider, defineExtension } from "@terminay/extension-api";

const providerId = "dev.terminay.agent-fixture/fixture";
const journalPath = ".fixture-agent/session.jsonl";

const provider = defineAgentProvider({
  mappingVersion: "1",
  matchesForeground(process) {
    return process.executableName === "fixture-agent";
  },
  async observe(terminal) {
    const journal = await terminal.observation.files.resolveHomeRelative(journalPath, {
      beneath: { homeRelative: ".fixture-agent" },
      extension: ".jsonl",
      signal: terminal.signal,
    });
    if (!journal) return { state: "not-bound" };
    const binding = await terminal.bindSession({
      providerSessionId: "fixture-session",
      mappingVersion: "1",
      journal,
      fingerprint: { kind: "fixture-journal", process: terminal.process, file: journal },
    });
    return {
      state: "bound",
      binding,
      source: terminal.observation.files.follow(journal, { signal: terminal.signal }),
      async mapRecord(record, context) {
        if (!record || typeof record !== "object" || Array.isArray(record)) return;
        if (record.type === "session") {
          await context.publish.sessionStarted({ title: bounded(record.title) });
        } else if (record.type === "turn" && typeof record.id === "string") {
          await context.publish.turnStarted({ turnId: bounded(record.id, 128) });
        } else if (record.type === "done") {
          await context.publish.done({ outcome: "success" });
        }
      },
    };
  },
});

function bounded(value, limit = 200) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : undefined;
}

export default defineExtension({
  activate(context) {
    context.subscriptions.add(context.agents.registerProvider(providerId, provider));
  },
});
