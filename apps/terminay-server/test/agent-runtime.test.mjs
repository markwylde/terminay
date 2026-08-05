import assert from "node:assert/strict";
import test from "node:test";
import { createStandaloneServer } from "../dist/index.js";
import { AgentStatusService, TerminalActivityService } from "@terminay/server-core";

test("standalone runtime starts and stops server-owned agent journal authority", async () => {
  const activity = new TerminalActivityService({ serverId: "runtime-agent-server" });
  const agents = new AgentStatusService({ activity });
  const runtime = createStandaloneServer({
    serverId: "runtime-agent-server",
    serverVersion: "1.0.0",
    dataRoot: "/tmp/terminay-agent-runtime",
    services: { activity, agents },
  });
  await runtime.start();
  assert.equal(runtime.state, "ready");
  assert.equal(agents.listening, true);
  agents.register({ serverId: "runtime-agent-server", projectId: "project-a", sessionId: "session-a" });
  assert.equal(agents.isSessionActive({ serverId: "runtime-agent-server", projectId: "project-a", sessionId: "session-a" }), true);
  await runtime.stop();
  assert.equal(runtime.state, "stopped");
  assert.equal(agents.listening, false);
});
