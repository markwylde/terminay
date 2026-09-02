import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import extension, { codexAgentProvider, effectiveCodexHome, mapCodexRecord } from "../dist/index.js";
import { createAgentExtensionHarness, fixtureTerminal } from "@terminay/extension-api/testing";

async function records() {
  return (await readFile(new URL("../fixtures/v0.1/basic.jsonl", import.meta.url), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
}

test("registers a Codex provider and binds only an exact writable root rollout", async () => {
  const input = await records();
  const journal = "/home/mark/.codex/sessions/2026/08/rollout-fixture.jsonl";
  const harness = await createAgentExtensionHarness(extension);
  try {
    await harness.observe(fixtureTerminal({ foregroundExecutable: "codex", files: { [journal]: input } }));
    assert.deepEqual(harness.events().map((event) => event.kind), [
      "session.started", "turn.started", "tool.started", "tool.finished", "wait.started", "agent.done",
    ]);
    assert.equal(harness.events()[0]?.title, "Codex");
    assert.equal(JSON.stringify(harness.events()).includes("private"), false);
  } finally {
    await harness.dispose();
  }
});

test("does not bind a Codex-looking record outside a rollout writer", async () => {
  const input = await records();
  const harness = await createAgentExtensionHarness(extension);
  try {
    await harness.observe(fixtureTerminal({ foregroundExecutable: "codex", files: { "/tmp/not-a-rollout.jsonl": input } }));
    assert.deepEqual(harness.events(), []);
  } finally {
    await harness.dispose();
  }
});

test("maps titles, collaboration children, completion and privacy allowlists", () => {
  const events = [];
  const publish = {
    publish: (event) => events.push(event),
    sessionStarted: (event) => events.push({ kind: "session.started", ...event }),
    metadataChanged: (event) => events.push({ kind: "agent.metadata", ...event }),
    turnStarted: (event) => events.push({ kind: "turn.started", ...event }),
    toolStarted: (event) => events.push({ kind: "tool.started", ...event }),
    toolFinished: (event) => events.push({ kind: "tool.finished", ...event }),
    waitStarted: (event) => events.push({ kind: "wait.started", ...event }),
    waitFinished: (event) => events.push({ kind: "wait.finished", ...event }),
    done: (event) => events.push({ kind: "agent.done", ...event }),
    exited: (event) => events.push({ kind: "agent.exited", ...event }),
    subagentStarted: (event) => events.push({ kind: "subagent.started", ...event }),
    sessionStopped: (event) => events.push({ kind: "session.stopped", ...event }),
    subagentDone: (event) => events.push({ kind: "subagent.done", ...event }),
  };
  const context = { binding: { providerSessionId: "root" }, publish };
  mapCodexRecord({ type: "event_msg", payload: { type: "item_completed", item: { type: "UserMessage", content: [{ type: "text", text: "Inspect the parser" }, { type: "image", image_url: "private" }] } } }, context);
  mapCodexRecord({ type: "event_msg", payload: { type: "collab_agent_spawn_end", new_thread_id: "child", sender_thread_id: "root", new_agent_nickname: "Ada", prompt: "Private child task", model: "gpt-5.6-terra", reasoning_effort: "high" } }, context);
  mapCodexRecord({ type: "event_msg", payload: { type: "collab_agent_interaction_end", receiver_thread_id: "child", status: { completed: "private result" } } }, context);
  mapCodexRecord({ type: "event_msg", payload: { type: "item_completed", item: { type: "SubAgentActivity", kind: "started", agent_thread_id: "child-live", agent_path: "/root/multiply" } } }, context);
  mapCodexRecord({ type: "response_item", payload: { type: "message", content: "private assistant output" } }, context);
  assert.deepEqual(events.map((event) => event.kind), ["agent.metadata", "subagent.started", "subagent.done", "subagent.started"]);
  assert.equal(events[0]?.promptText, "Inspect the parser");
  assert.equal(events[1]?.title, "Ada");
  assert.deepEqual(events[1]?.model, { id: "gpt-5.6-terra", reasoningEffort: "high" });
  assert.deepEqual(events[3], { kind: "subagent.started", subagentId: "child-live", title: "multiply" });
  assert.equal(JSON.stringify(events).includes("private assistant"), false);
  assert.equal(JSON.stringify(events).includes("private result"), false);
});

test("uses a stable root prompt, ignores abort guidance, and recognizes Codex executables", () => {
  const events = [];
  const publish = Object.fromEntries([
    ["publish", (event) => events.push(event)], ["sessionStarted", (event) => events.push(event)],
    ["metadataChanged", (event) => events.push(event)], ["turnStarted", (event) => events.push(event)],
    ["toolStarted", (event) => events.push(event)], ["toolFinished", (event) => events.push(event)],
    ["waitStarted", (event) => events.push(event)], ["waitFinished", (event) => events.push(event)],
    ["done", (event) => events.push(event)], ["exited", (event) => events.push(event)],
    ["subagentStarted", (event) => events.push(event)], ["subagentDone", (event) => events.push(event)],
  ]);
  const context = { binding: { providerSessionId: "root" }, publish };
  const state = { promptPublished: false };
  mapCodexRecord({ type: "event_msg", payload: { type: "user_message", message: "<turn_aborted>private</turn_aborted>" } }, context, state);
  mapCodexRecord({ type: "event_msg", payload: { type: "user_message", message: "First prompt" } }, context, state);
  mapCodexRecord({ type: "event_msg", payload: { type: "user_message", message: "Second prompt" } }, context, state);
  assert.equal(events.length, 1);
  assert.equal(events[0].promptText, "First prompt");
  assert.equal(codexAgentProvider.matchesForeground({ executableName: "codex" }), true);
  assert.equal(codexAgentProvider.matchesForeground({ executableName: "bash" }), false);
  assert.match(effectiveCodexHome({ HOME: "/home/ignored", CODEX_HOME: "/custom/codex" }), /\/custom\/codex$/u);
});
