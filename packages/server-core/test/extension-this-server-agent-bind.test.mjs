import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentStatusService,
  ExtensionAgentRuntimeRegistry,
  ExtensionHostManager,
  TerminalActivityService,
  createExtensionAgentBroker,
} from "../dist/index.js";

async function fixture(extensionId, source) {
  const root = await mkdtemp(join(tmpdir(), "terminay-this-server-agent-"));
  await writeFile(join(root, "extension.js"), source, { mode: 0o600 });
  for (const name of ["config", "data", "cache"]) await mkdir(join(root, name));
  return {
    extensionId,
    packageRoot: root,
    entrypoint: "extension.js",
    configDirectory: join(root, "config"),
    dataDirectory: join(root, "data"),
    cacheDirectory: join(root, "cache"),
    permissions: ["agent-observation"],
    agentProviders: [{
      id: `${extensionId}/cli`,
      displayName: "Live journal fixture",
      processMatchers: [{ executableName: "codex" }],
      requiredEnvironmentCapabilities: ["process-observation", "filesystem-observation", "agent-journal"],
    }],
  };
}

async function spawnJournalTree(journalPath) {
  const shell = spawn(process.execPath, ["-e", `
    const { spawn } = require("node:child_process");
    const child = spawn(process.execPath, ["-e", "require('node:fs').openSync(process.argv[1], 'r+'); setInterval(() => {}, 1000);", process.argv[1]], { stdio: "ignore" });
    if (typeof child.pid !== "number") throw new Error("journal holder pid is missing");
    process.send({ holderPid: child.pid });
    setInterval(() => {}, 1000);
  `, journalPath], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const [message] = await once(shell, "message");
  return { shell, holderPid: message.holderPid };
}

async function waitUntil(predicate, timeoutMs = 5_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out waiting for This-server agent bind");
}

test("This-server observation in the extension child binds a live writable journal and fills the Agents snapshot", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "terminay-codex-journal-"));
  const journalPath = join(directory, "sessions", "rollout-live.jsonl");
  await mkdir(join(directory, "sessions"));
  await writeFile(journalPath, `${JSON.stringify({
    type: "session_meta",
    payload: { id: "live-root", originator: "codex-tui", source: "cli", model: "gpt-5.4" },
  })}\n`);
  const tree = await spawnJournalTree(journalPath);
  t.after(() => {
    try { process.kill(tree.holderPid, "SIGKILL"); } catch { /* already exited */ }
    try { tree.shell.kill("SIGKILL"); } catch { /* already exited */ }
  });

  const identity = { serverId: "server-live", projectId: "project-live", sessionId: "terminal-live" };
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const agents = new AgentStatusService({ activity });
  await agents.start();
  agents.register(identity);
  t.after(async () => { await agents.stop().catch(() => undefined); });

  const manager = new ExtensionHostManager({
    broker: { async request() {} },
    agents: createExtensionAgentBroker(agents),
  });
  t.after(async () => { await manager.shutdown().catch(() => undefined); });

  const descriptor = await fixture("example.agent-live", `
    export function activate(context) {
      context.agents.registerProvider("example.agent-live/cli", {
        mappingVersion: "0.1",
        matchesForeground() { return true; },
        async observe(terminal) {
          const descendants = await terminal.observation.processes.descendants();
          const files = await terminal.observation.processes.openFiles(descendants, { access: "writable" });
          const journal = files.find((file) => String(file.path).includes("rollout-live.jsonl"));
          if (!journal) return { state: "not-bound" };
          const canonical = await terminal.observation.files.canonicalFile(journal.handle, { extension: ".jsonl" });
          const header = await terminal.observation.files.readJsonLine(canonical, { position: "first", maxBytes: 65536 });
          const binding = await terminal.bindSession({
            providerSessionId: header.payload.id,
            mappingVersion: "0.1",
            journal: canonical,
            fingerprint: { kind: "writable-file-below-terminal-process", file: journal.handle },
          });
          return {
            state: "bound",
            binding,
            source: await terminal.observation.files.follow(canonical, { maxChunkBytes: 65536 }),
            mapRecord(record, session) {
              if (record.type === "session_meta") session.publish.sessionStarted({ title: "Codex" });
            },
          };
        },
      });
    }
  `);
  await manager.start(descriptor);

  const runtime = new ExtensionAgentRuntimeRegistry({ agents, hosts: manager, reobserveDebounceMs: 0 });
  runtime.register(identity);
  runtime.terminalStarted(identity, tree.shell.pid);
  assert.equal(runtime.foregroundProcessChanged(identity, "codex"), true);

  const entry = await waitUntil(() => {
    const candidate = Object.values(agents.getSnapshot().entries)[0];
    return candidate?.displayName === "Codex" ? candidate : undefined;
  });
  assert.equal(entry.displayName, "Codex");
  assert.equal(entry.provider, "example.agent-live/cli");
  assert.equal(entry.active, true);
  assert.equal(entry.sessionId, "live-root");
});
