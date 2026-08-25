import assert from "node:assert/strict";
import test from "node:test";
import extension, { mapClaudeRecord } from "../dist/index.js";
import { createAgentExtensionHarness, fixtureTerminal } from "@terminay/extension-api/testing";

const firstId = "5f2aff08-eab3-4852-96eb-48235fc7f471";
const secondId = "bf0b34e1-4afc-4b93-8389-80caa0b589a4";

function root(sessionId, prompt) {
  return [
    { type: "permission-mode", mode: "default", sessionId, version: "2.1.201" },
    { type: "user", sessionId, promptId: `prompt-${sessionId}`, message: { role: "user", content: prompt } },
  ];
}

test("two terminal process trees bind independent new Claude roots without cross-terminal leakage", async () => {
  const left = await createAgentExtensionHarness(extension);
  const right = await createAgentExtensionHarness(extension);
  try {
    await Promise.all([
      left.observe(fixtureTerminal({ foregroundExecutable: "claude", files: { [`/fixture/.claude/projects/-left/${firstId}.jsonl`]: root(firstId, "left-only") } })),
      right.observe(fixtureTerminal({ foregroundExecutable: "claude", files: { [`/fixture/.claude/projects/-right/${secondId}.jsonl`]: root(secondId, "right-only") } })),
    ]);
    assert.equal(JSON.stringify(left.events()).includes("left-only"), true);
    assert.equal(JSON.stringify(left.events()).includes("right-only"), false);
    assert.equal(JSON.stringify(right.events()).includes("right-only"), true);
    assert.equal(JSON.stringify(right.events()).includes("left-only"), false);
  } finally { await Promise.all([left.dispose(), right.dispose()]); }
});

test("an exact native resume identity rebinds to its project journal even when unrelated writable history exists", async () => {
  const harness = await createAgentExtensionHarness(extension);
  try {
    const resumed = `/home/test/.claude/projects/-work-repo/${secondId}.jsonl`;
    const unrelated = `/fixture/.claude/projects/-other/${firstId}.jsonl`;
    const terminal = fixtureTerminal({
      foregroundExecutable: "claude", arguments: ["--resume", secondId], cwd: "/work/repo",
      files: { [resumed]: root(secondId, "resumed-only"), [unrelated]: root(firstId, "unrelated") },
    });
    await harness.observe(terminal);
    assert.equal(JSON.stringify(harness.events()).includes("resumed-only"), true);
    assert.equal(JSON.stringify(harness.events()).includes("unrelated"), false);
  } finally { await harness.dispose(); }
});

test("topology replacement re-observes a new exact writer rather than retaining the old session", async () => {
  const harness = await createAgentExtensionHarness(extension);
  try {
    await harness.observe(fixtureTerminal({ foregroundExecutable: "claude", files: { [`/fixture/.claude/projects/-one/${firstId}.jsonl`]: root(firstId, "first topology") } }));
    await harness.observe(fixtureTerminal({ foregroundExecutable: "claude", files: { [`/fixture/.claude/projects/-two/${secondId}.jsonl`]: root(secondId, "second topology") } }));
    assert.deepEqual(harness.events().filter((event) => event.kind === "session.started").length, 2);
    assert.deepEqual(harness.events().filter((event) => event.kind === "turn.started").map((event) => event.promptText), ["first topology", "second topology"]);
  } finally { await harness.dispose(); }
});

test("malformed, oversized and content-bearing Claude records fail closed", async () => {
  const events = [];
  const publish = new Proxy({ publish: (event) => events.push(event) }, { get(target, name) { return name in target ? target[name] : (event) => events.push({ kind: String(name), ...event }); } });
  const context = { binding: { providerSessionId: firstId }, publish };
  for (const record of [
    null, [], {},
    { type: "user", sessionId: firstId, promptId: "oversized", message: { role: "user", content: "x".repeat(4_001) } },
    { type: "assistant", sessionId: firstId, uuid: "assistant", message: { role: "assistant", content: [{ type: "text", text: "PRIVATE ASSISTANT" }] } },
    { type: "progress", sessionId: firstId, data: { output: "PRIVATE TOOL OUTPUT" } },
  ]) await mapClaudeRecord(record, context);
  assert.equal(JSON.stringify(events).includes("PRIVATE"), false);
  assert.equal(JSON.stringify(events).includes("xxxx"), false);
});
