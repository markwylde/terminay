import assert from "node:assert/strict";
import test from "node:test";
import { ExtensionsClient } from "../dist/index.js";

function clientFor(response) {
  return new ExtensionsClient({
    async query() {
      return response;
    },
    async command() {
      return response;
    },
  });
}

test("the extension list keeps a session source's harnesses for Settings", async () => {
  const catalogue = await clientFor({
    revision: 3,
    extensions: [
      {
        extensionId: "com.terminay.builtin-agents",
        packageName: "terminay-builtin-agents",
        displayName: "Built-in Agents",
        official: true,
        enabled: true,
        runtimeState: "running",
        activeVersion: "0.1.0",
        agentSessionSources: [
          {
            id: "com.terminay.builtin-agents/agents",
            displayName: "Coding agents",
            harnesses: [
              { id: "claude-code", displayName: "Claude Code" },
              { id: "grok", displayName: "Grok" },
            ],
          },
        ],
      },
      {
        extensionId: "com.terminay.language.typescript",
        packageName: "terminay-language-typescript",
        displayName: "TypeScript",
        official: true,
        enabled: true,
        runtimeState: "running",
      },
    ],
  }).list();
  const [agents, typescript] = catalogue.extensions;
  assert.deepEqual(agents.agentSessionSources, [
    {
      id: "com.terminay.builtin-agents/agents",
      displayName: "Coding agents",
      harnesses: [
        { id: "claude-code", displayName: "Claude Code" },
        { id: "grok", displayName: "Grok" },
      ],
    },
  ]);
  assert.equal("agentSessionSources" in typescript, false);
});

test("a malformed session source is rejected rather than shown", async () => {
  await assert.rejects(
    clientFor({
      revision: 1,
      extensions: [
        {
          extensionId: "com.example.agents",
          packageName: "example-agents",
          enabled: true,
          agentSessionSources: [{ id: "", displayName: "Broken", harnesses: [] }],
        },
      ],
    }).list(),
    /invalid text/u,
  );
});
