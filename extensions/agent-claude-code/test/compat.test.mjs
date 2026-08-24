import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import extension from "../dist/index.js";
import { createAgentExtensionHarness, fixtureTerminal } from "@terminay/extension-api/testing";

const sessionId = "5f2aff08-eab3-4852-96eb-48235fc7f471";

test("Claude Code mapping v0.1 remains compatible with the captured project-session fixture", async () => {
  const records = (await readFile(new URL("../fixtures/project-session-v01.jsonl", import.meta.url), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
  const harness = await createAgentExtensionHarness(extension);
  try {
    await harness.observe(fixtureTerminal({
      foregroundExecutable: "claude",
      files: { [`/fixture/.claude/projects/-workspace/${sessionId}.jsonl`]: records },
    }));
    const events = harness.events();
    assert.equal(events.some((event) => event.kind === "agent.metadata" && event.title === "Investigate the parser"), true);
    assert.equal(events.some((event) => event.kind === "tool.started" && event.name === "Bash"), true);
    assert.equal(events.some((event) => event.kind === "subagent.started" && event.subagentId === "toolu-agent"), true);
    assert.equal(events.some((event) => event.kind === "tool.finished" && event.toolId === "toolu-shell"), true);
    const serialized = JSON.stringify(events);
    assert.equal(serialized.includes("redacted"), false, "tool input/output must remain provider-private");
  } finally { await harness.dispose(); }
});
