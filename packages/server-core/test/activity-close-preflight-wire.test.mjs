import assert from "node:assert/strict";
import test from "node:test";
import { ActivityClient, ACTIVITY_OPERATIONS as CLIENT_OPERATIONS, TerminayClient } from "@terminay/client-core";
import { encodeFrame } from "@terminay/protocol";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  ACTIVITY_OPERATIONS as SERVER_OPERATIONS,
  createServerCoreComposition,
  TerminalActivityService,
} from "../dist/index.js";

/**
 * Destructive close protection is only as good as the request that carries
 * it. These tests send the close preflight through a real client, the frame
 * codec and a real connection, because a handler that is correct in isolation
 * protects nothing if the client cannot encode the request that reaches it:
 * the client then falls back to the committed projection, which is exactly
 * the stale answer the preflight exists to replace.
 */

function createObservedPty() {
  const foregroundListeners = new Set();
  const state = { refreshes: 0, foreground: "zsh" };
  const process = {
    pid: 4242,
    write() {}, resize() {}, kill() {},
    onData() { return () => {}; },
    onExit() { return () => {}; },
    onForegroundProcess(listener) { foregroundListeners.add(listener); return () => foregroundListeners.delete(listener); },
    async refreshForegroundProcess() {
      state.refreshes += 1;
      for (const listener of [...foregroundListeners])
        listener({ processName: state.foreground, shellForeground: state.foreground === "zsh", observation: "available" });
    },
  };
  return { state, factory: { spawn: () => process } };
}

async function connected(t, pty) {
  const activity = new TerminalActivityService({ serverId: "close-preflight" });
  const composition = createServerCoreComposition({
    allowUnresolvedTestSessions: true,
    serverId: "close-preflight",
    serverVersion: "1.0.0",
    capabilities: ["desktop"],
    ptyFactory: pty.factory,
    activity,
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "admin" }),
  });
  await composition.terminal.createSession({ projectId: "project-a", sessionId: "session-a", cols: 80, rows: 24 });
  const pair = createInMemoryTransportPair();
  const serverTask = composition.core.accept(pair.server).start();
  const client = new TerminayClient({ transport: pair.client, clientId: "desktop-client" });
  t.after(async () => {
    await client.close().catch(() => undefined);
    await serverTask.catch(() => undefined);
    await composition.shutdown();
  });
  await pair.open();
  await client.connect();
  return { activity, client };
}

test("every activity operation name can be encoded on the wire, and both sides agree on it", () => {
  assert.deepEqual({ ...CLIENT_OPERATIONS }, { ...SERVER_OPERATIONS });
  for (const operation of Object.values(SERVER_OPERATIONS)) {
    if (operation === SERVER_OPERATIONS.event) continue;
    assert.doesNotThrow(
      () => encodeFrame({ type: "query", queryId: "q1", operation, payload: {} }),
      `${operation} is not a valid wire operation name`,
    );
  }
});

test("a close preflight sent by a real client reaches the server and takes a fresh observation", async (t) => {
  const pty = createObservedPty();
  const { activity, client } = await connected(t, pty);
  const identity = { serverId: "close-preflight", projectId: "project-a", sessionId: "session-a" };

  // The committed projection has not caught up: it still believes the shell
  // is in the foreground, as it does in the moment after a command starts.
  assert.notEqual(activity.get(identity)?.foregroundBusy, true);
  pty.state.foreground = "sleep";

  const activityClient = new ActivityClient({
    query: async (operation, payload, options) => (await client.query(operation, payload, options)).result,
    command: async (operation, payload, options) => (await client.command(operation, payload, options)).result,
    subscribe: () => () => {},
  });
  const preflight = await activityClient.closePreflight({ projectId: "project-a", sessionId: "session-a" });

  assert.equal(pty.state.refreshes, 1, "the server never asked the PTY for a fresh observation");
  assert.equal(preflight.observation, "available");
  assert.deepEqual(preflight.runningSessionIds, ["session-a"]);
});

test("a close preflight for an idle shell reports nothing running", async (t) => {
  const pty = createObservedPty();
  const { client } = await connected(t, pty);
  const result = await client.query(SERVER_OPERATIONS.closePreflight, { projectId: "project-a", sessionId: "session-a" });
  assert.equal(pty.state.refreshes, 1);
  assert.deepEqual(result.result.runningSessionIds, []);
});
