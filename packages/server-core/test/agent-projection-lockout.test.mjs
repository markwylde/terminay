import assert from "node:assert/strict";
import test from "node:test";
import { TerminayClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  AgentStatusService,
  createServerCoreComposition,
  TerminalActivityService,
} from "../dist/index.js";

function createPtyFactory() {
  const processes = [];
  return {
    processes,
    spawn() {
      const dataListeners = new Set();
      const exitListeners = new Set();
      const process = {
        pid: 8_000 + processes.length,
        write() {},
        resize() {},
        kill() {},
        onData(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener); },
        onExit(listener) { exitListeners.add(listener); return () => exitListeners.delete(listener); },
      };
      processes.push(process);
      return process;
    },
  };
}

test("Codex journal replay cannot close the application connection or block terminal creation", { timeout: 5_000 }, async () => {
  const pty = createPtyFactory();
  let now = 1;
  const activity = new TerminalActivityService({
    serverId: "agent-lockout-server",
    now: () => now,
    setTimeout: () => 1,
    clearTimeout: () => undefined,
  });
  const agents = new AgentStatusService({ activity, now: () => now });
  await agents.start();
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "agent-lockout-server",
    serverVersion: "1.0.0",
    capabilities: ["agents"],
    ptyFactory: pty,
    activity,
    agents,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
  });
  const identity = {
    serverId: "agent-lockout-server",
    projectId: "project-a",
    sessionId: "terminal-a",
  };
  await composition.terminal.createSession({
    projectId: identity.projectId,
    sessionId: identity.sessionId,
    cols: 80,
    rows: 24,
  });

  const pair = createInMemoryTransportPair();
  let blockServerWrites = false;
  let releaseServerWrites = () => undefined;
  let serverWriteGate = Promise.resolve();
  const serverTransport = new Proxy(pair.server, {
    get(target, property) {
      if (property === "waitForWritable") return async (requiredBytes, signal) => {
        if (blockServerWrites) await serverWriteGate;
        return target.waitForWritable(requiredBytes, signal);
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const deliveryDiagnostics = [];
  const connection = composition.core.accept(serverTransport, {
    onDeliveryDiagnostic: (diagnostic) => deliveryDiagnostics.push(diagnostic),
  });
  const serverTask = connection.start();
  const client = new TerminayClient({
    transport: pair.client,
    clientId: "stalled-renderer",
    capabilities: ["events.resync"],
  });
  let subscription;
  let resyncs = 0;
  try {
    await pair.open();
    await client.connect();
    subscription = await client.subscribe("agent");
    subscription.onResync(() => { resyncs += 1; });
    blockServerWrites = true;
    serverWriteGate = new Promise((resolve) => { releaseServerWrites = resolve; });

    await agents.ingestJournalRecord(identity, "codex", {
      type: "session_meta",
      payload: { id: "large-resumed-codex-session", cli_version: "0.2.0" },
    });
    for (let index = 0; index < 2_000; index += 1) {
      now += 1;
      await agents.ingestJournalRecord(identity, "codex", {
        type: "event_msg",
        payload: { type: "request_user_input" },
      });
    }
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(deliveryDiagnostics.some((diagnostic) => diagnostic.phase === "failure"), false);
    assert.equal(connection.state, "open", "agent projection pressure closed the shared application connection");
    releaseServerWrites();
    blockServerWrites = false;
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(resyncs <= 1, "agent projection pressure emitted repeated resync requests");
    const created = await client.command("terminal.create", {
      projectId: "project-a",
      cwd: "/repo/a",
      cols: 80,
      rows: 24,
    });
    assert.equal(typeof created.result.sessionId, "string");
  } finally {
    releaseServerWrites();
    await subscription?.unsubscribe().catch(() => undefined);
    await client.close().catch(() => undefined);
    await serverTask.catch(() => undefined);
    await composition.shutdown();
  }
});
