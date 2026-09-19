import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createStandaloneServer } from "../dist/index.js";
import {
  AgentStatusService,
  ExtensionHostManager,
  ProjectAgentScope,
  SessionSourceBridge,
  SessionSourceSupervisor,
  TerminalActivityService,
} from "@terminay/server-core";

test("standalone runtime starts and stops the server-owned agent authority", async () => {
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

async function eventually(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition never held");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("a fixture session source runs in a real extension child and reaches the Agents snapshot", async (t) => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "terminay-agent-runtime-")));
  t.after(() => rm(base, { recursive: true, force: true }));
  const project = join(base, "project");
  await mkdir(join(project, "src"), { recursive: true });
  // The "agent": a real process under this test process, which stands in for
  // a PTY shell. A second one runs under nothing Terminay owns.
  const agent = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  t.after(() => agent.kill("SIGKILL"));
  await new Promise((resolve) => agent.once("spawn", resolve));
  const packageRoot = join(base, "extension");
  for (const name of ["", "config", "data", "cache"]) await mkdir(join(packageRoot, name), { recursive: true });
  await writeFile(join(packageRoot, "extension.js"), `
    export function activate(context) {
      context.agents.registerSessionSource("com.example.fixture-agents/agents", {
        start({ publisher, enabledHarnesses }) {
          publisher.reset([
            { id: "bound", harness: "fixture", pid: ${agent.pid}, cwd: ${JSON.stringify(join(project, "src"))}, status: "running", title: "Bound fixture" },
            { id: "external", harness: "fixture", pid: 1, cwd: ${JSON.stringify(project)}, status: "waiting", waitingFor: enabledHarnesses.join(",") },
          ]);
        },
      });
    }
  `);

  const activity = new TerminalActivityService({ serverId: "fixture-server" });
  const agents = new AgentStatusService({ activity });
  await agents.start();
  const scope = new ProjectAgentScope();
  t.after(() => scope.dispose());
  scope.setProject("project-a", project);
  await scope.settled();
  const bridge = new SessionSourceBridge({ agents, scope });
  const supervisor = new SessionSourceSupervisor({ bridge, agents });
  const hosts = new ExtensionHostManager({ broker: { async request() {} }, agents: supervisor });
  t.after(() => hosts.shutdown());
  const terminal = { serverId: "fixture-server", projectId: "project-a", sessionId: "terminal-a" };
  activity.register(terminal);
  agents.register(terminal);
  agents.terminalStarted(terminal, process.pid);
  supervisor.attach(hosts);
  await hosts.start({
    extensionId: "com.example.fixture-agents",
    packageRoot,
    entrypoint: "extension.js",
    configDirectory: join(packageRoot, "config"),
    dataDirectory: join(packageRoot, "data"),
    cacheDirectory: join(packageRoot, "cache"),
    permissions: ["agent-observation"],
    agentSessionSources: [{
      id: "com.example.fixture-agents/agents",
      displayName: "Fixture Agents",
      harnesses: [{ id: "fixture", displayName: "Fixture Agent" }],
    }],
  });

  await eventually(() => Object.keys(agents.getSnapshotForProject("project-a").entries).length === 2);
  const entries = Object.values(agents.getSnapshotForProject("project-a").entries);
  const bound = entries.find((entry) => entry.displayName === "Bound fixture");
  const external = entries.find((entry) => entry.external);
  assert.equal(bound.activationTerminalSessionId, "terminal-a");
  assert.equal(bound.state, "working");
  assert.equal(bound.providerDisplayName, "Fixture Agent");
  assert.equal(external.state, "waiting");
  assert.equal(external.waitingReason, "fixture");
  assert.equal(external.activationTerminalSessionId, null);

  await hosts.stop("com.example.fixture-agents");
  await eventually(() => Object.keys(agents.getSnapshot().entries).length === 0);
});
