import assert from "node:assert/strict";
import test from "node:test";
import extension, { PROVIDER_ID } from "../dist/index.js";
import { createAgentExtensionHarness, fixtureTerminal } from "@terminay/extension-api/testing";

const sessionId = "5f2aff08-eab3-4852-96eb-48235fc7f471";
const journal = `/fixture/.claude/projects/-workspace/${sessionId}.jsonl`;

test("Claude Code registers its public provider and maps root lifecycle facts", async () => {
  assert.equal(PROVIDER_ID, "com.terminay.agent.claude-code/cli");
  const harness = await createAgentExtensionHarness(extension);
  try {
    await harness.observe(fixtureTerminal({
      foregroundExecutable: "claude",
      files: {
        [journal]: [
          { type: "permission-mode", mode: "default", sessionId, version: "2.1.201" },
          { type: "ai-title", sessionId, aiTitle: "Investigate the parser" },
          { type: "user", sessionId, promptId: "prompt-1", message: { role: "user", content: "Inspect the parser" } },
          { type: "assistant", sessionId, uuid: "assistant-1", message: {
            role: "assistant", model: "claude-opus-4-8", content: [
              { type: "tool_use", id: "toolu-shell", name: "Bash", input: { command: "private command" } },
              { type: "tool_use", id: "toolu-agent", name: "Agent", input: { description: "Research parser", prompt: "Inspect the journal", subagent_type: "general-purpose" } },
              { type: "tool_use", id: "toolu-question", name: "AskUserQuestion", input: { questions: "private" } },
            ],
          } },
          { type: "user", sessionId, uuid: "result-1", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu-shell", is_error: false, content: "private output" }] } },
          { type: "assistant", sessionId, uuid: "assistant-2", message: { role: "assistant", model: "claude-opus-4-8", content: [], stop_reason: "end_turn" } },
        ],
      },
    }));
    assert.deepEqual(harness.events(), [
      { kind: "session.started", title: "Claude Code" },
      { kind: "agent.metadata", title: "Investigate the parser" },
      { kind: "turn.started", turnId: "prompt-1", promptText: "Inspect the parser" },
      { kind: "agent.metadata", model: { id: "claude-opus-4-8" } },
      { kind: "turn.started", turnId: "assistant-1" },
      { kind: "tool.started", toolId: "toolu-shell", name: "Bash" },
      { kind: "subagent.started", subagentId: "toolu-agent", parentAgentId: sessionId, title: "Research parser", promptText: "Inspect the journal", model: { id: "claude-opus-4-8" } },
      { kind: "wait.started", waitId: "toolu-question", state: "waiting", reason: "AskUserQuestion" },
      { kind: "tool.finished", toolId: "toolu-shell", outcome: "success" },
      { kind: "agent.metadata", model: { id: "claude-opus-4-8" } },
      { kind: "turn.started", turnId: "assistant-2" },
      { kind: "agent.done", outcome: "success" },
    ]);
  } finally { await harness.dispose(); }
});

test("Claude Code rejects sidechains and injected command metadata", async () => {
  const harness = await createAgentExtensionHarness(extension);
  try {
    await harness.observe(fixtureTerminal({
      foregroundExecutable: "claude",
      files: {
        [journal]: [
          { type: "permission-mode", sessionId, isSidechain: true },
          { type: "user", sessionId, uuid: "unsafe", message: { role: "user", content: "<command-name>private" } },
        ],
      },
    }));
    assert.deepEqual(harness.events(), []);
  } finally { await harness.dispose(); }
});

test("Claude Code refuses ambiguous root journals rather than choosing history by filename or time", async () => {
  const otherSession = "bf0b34e1-4afc-4b93-8389-80caa0b589a4";
  const harness = await createAgentExtensionHarness(extension);
  try {
    await harness.observe(fixtureTerminal({
      foregroundExecutable: "claude",
      files: {
        [journal]: [{ type: "permission-mode", sessionId }],
        [`/fixture/.claude/projects/-other/${otherSession}.jsonl`]: [{ type: "permission-mode", sessionId: otherSession }],
      },
    }));
    assert.deepEqual(harness.events(), []);
  } finally { await harness.dispose(); }
});

test("Claude Code binds an explicit --resume UUID before Claude opens that journal for writing", async () => {
  const resumedJournal = `/home/test/.claude/projects/-workspace-github-io/${sessionId}.jsonl`;
  const harness = await createAgentExtensionHarness(extension);
  try {
    const terminal = fixtureTerminal({
      foregroundExecutable: "claude",
      arguments: ["--resume", sessionId],
      cwd: "/workspace.github.io",
      files: { [resumedJournal]: [{ type: "permission-mode", sessionId, version: "2.1.201" }] },
    });
    terminal.observation.processes.openFiles = async () => [];
    await harness.observe(terminal);
    assert.deepEqual(harness.events(), [{ kind: "session.started", title: "Claude Code" }]);
  } finally { await harness.dispose(); }
});

test("Claude Code rejects a resume path whose root header does not prove the requested UUID", async () => {
  const harness = await createAgentExtensionHarness(extension);
  try {
    const terminal = fixtureTerminal({
      foregroundExecutable: "claude",
      arguments: [`--resume=${sessionId}`],
      cwd: "/workspace.github.io",
      files: { [`/home/test/.claude/projects/-workspace-github-io/${sessionId}.jsonl`]: [{ type: "permission-mode", sessionId: "bf0b34e1-4afc-4b93-8389-80caa0b589a4" }] },
    });
    terminal.observation.processes.openFiles = async () => [];
    await harness.observe(terminal);
    assert.deepEqual(harness.events(), []);
  } finally { await harness.dispose(); }
});

test("Claude Code reports an unavailable environment instead of using local paths", async () => {
  const harness = await createAgentExtensionHarness(extension);
  try {
    await harness.observe(fixtureTerminal({ foregroundExecutable: "claude", capabilities: ["agent-journal"], files: { [journal]: [{ type: "permission-mode", sessionId }] } }));
    assert.deepEqual(harness.events(), []);
  } finally { await harness.dispose(); }
});
