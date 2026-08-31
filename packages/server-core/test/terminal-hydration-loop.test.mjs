import test from "node:test";
import assert from "node:assert/strict";
import { TerminayClient, TerminayClientFacade, TerminayTerminalClient } from "@terminay/client-core";
import { createInMemoryTransportPair } from "@terminay/protocol-conformance";
import {
  createServerCore,
  createTerminalOperationRegistry,
  OrderedEventJournal,
  TerminalPresentationCheckpointAuthority,
  TerminalService,
} from "../dist/index.js";

/**
 * A congested terminal must come back.
 *
 * Congestion is a normal, expected state: a renderer that briefly stops
 * acknowledging - hydrating a large checkpoint, a backgrounded tab, a slow
 * link - trips the unconfirmed-bytes or unconfirmed-age bound. The server then
 * discards that attachment's queued output, states the gap as one ordered skip,
 * and suppresses further output until the client recovers.
 *
 * The failure this pins is what happens next: if suppression can only be
 * lifted by an acknowledgement, and acknowledgements are only produced by
 * output, then a suppressed attachment can never produce the acknowledgement
 * that would unsuppress it. The terminal is mounted, the connection is healthy
 * and carrying other traffic, and that one terminal never streams again.
 */

function createPtyFactory() {
  const processes = [];
  return {
    processes,
    spawn(options) {
      const dataListeners = new Set();
      const exitListeners = new Set();
      const process = {
        pid: 9000 + processes.length,
        options,
        writes: [],
        resizes: [],
        write(bytes) { this.writes.push(new Uint8Array(bytes)); },
        resize(dimensions) { this.resizes.push({ ...dimensions }); },
        kill() {},
        onData(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener); },
        onExit(listener) { exitListeners.add(listener); return () => exitListeners.delete(listener); },
        emitData(value) {
          const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
          for (const listener of dataListeners) listener(bytes);
        },
      };
      processes.push(process);
      return process;
    },
  };
}

const settle = async (turns = 25) => {
  for (let index = 0; index < turns; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

/**
 * Wait for a condition instead of for a fixed number of event-loop turns.
 *
 * Recovery crosses real timers - a fresh presentation waits for the checkpoint
 * drain within a deadline - so counting turns measures how loaded the machine
 * is rather than whether the terminal recovered. Returns false on timeout so
 * the caller can assert with a useful message.
 */
const waitUntil = async (predicate, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return predicate();
};

async function harness() {
  const pty = createPtyFactory();
  const checkpoints = new TerminalPresentationCheckpointAuthority();
  const service = new TerminalService({
    serverId: "server-hydration",
    ptyFactory: pty,
    generateSessionId: (() => { let n = 0; return () => `session-hydration-${++n}`; })(),
    presentationCheckpoints: checkpoints,
  });
  const session = await service.createSession({ projectId: "project-hydration", cols: 80, rows: 24 });
  const journal = new OrderedEventJournal();
  const registry = createTerminalOperationRegistry({
    service,
    eventJournal: journal,
    checkpoints,
    allowUnresolvedTestSessions: true,
  });
  const congestion = [];
  const pair = createInMemoryTransportPair();
  const connection = createServerCore({
    serverId: "server-hydration",
    serverVersion: "test",
    capabilities: ["terminal"],
    authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: "write" }),
    eventJournal: journal,
    ...registry.operations,
    onConnectionClosed: (connectionId) => registry.closeConnection(connectionId),
    onTerminalCongestion: (attachmentId, clientId, connectionId) => {
      congestion.push({ attachmentId, clientId, connectionId });
      registry.suppressOutput(attachmentId, connectionId);
    },
  }).accept(pair.server);
  const task = connection.start().catch(() => undefined);
  const client = new TerminayClient({ transport: pair.client, clientId: "device-web", capabilities: ["terminal", "events.resync"] });
  const facade = new TerminayClientFacade(client);
  const terminal = new TerminayTerminalClient({
    command: facade.command.bind(facade),
    subscribe: client.subscribe.bind(client),
    // Checkpoint hydration is a binary query, exactly as the real panel does it.
    queryWithBody: client.queryWithBody.bind(client),
  });
  await pair.open();
  await client.connect();
  return {
    congestion, client, connection, identity: {
      serverId: "server-hydration",
      projectId: "project-hydration",
      sessionId: session.sessionId,
    }, journal, pty, service, task, terminal,
  };
}


/**
 * Hydration must not re-arm its own recovery.
 *
 * A fresh presentation whose checkpoint lags the live head carries a skip
 * describing the range it will never deliver. The panel treats a skip as
 * "I fell behind, re-attach from a fresh checkpoint". If that skip arrives as
 * part of the attach itself, hydrating triggers another hydration, whose
 * checkpoint is just as stale, forever. The transport stays healthy and busy
 * the whole time, which is exactly what makes this look like a dead terminal
 * rather than a loop: bytes keep arriving and nothing is ever painted.
 */
test("hydrating a stale checkpoint does not re-trigger its own recovery", async () => {
  const h = await harness();
  try {
    // Enough output that the checkpoint authority is left far behind the PTY.
    for (let index = 0; index < 400; index += 1) h.pty.processes[0].emitData("x".repeat(1024));
    // Let the checkpoint authority finish ingesting, so this test measures the
    // hydration contract rather than how many turns a drain happened to get.
    await h.service.settlePresentation(h.identity, 10_000);
    await settle(20);

    const rendered = [];
    const skips = [];
    let attaches = 0;
    const MAX = 6;

    // The panel recovers when a live display falls behind. A gap the server
    // establishes while attaching is already covered by the position the
    // attachment starts from, and re-attaching would reproduce it, so it is
    // explicitly not a recovery trigger. This mirrors `isRecoverableSkip` in
    // TerminalPanel.
    const isRecoverable = (event) =>
      event.type === "skip" && event.reason !== "hydration";

    const openPanel = async () => {
      attaches += 1;
      if (attaches > MAX) return;
      const attachment = await h.terminal.attach({
        ...h.identity,
        clientId: "device-web",
        fromPosition: 0,
        freshPresentation: true,
      });
      const handle = (event) => {
        if (event.type === "output") {
          rendered.push(new TextDecoder().decode(event.bytes));
          void attachment.ack(event.nextPosition).catch(() => undefined);
        }
        if (event.type === "skip") skips.push(event);
        if (isRecoverable(event) && attaches <= MAX) void openPanel();
      };
      attachment.onEvent(handle);
      for (const event of attachment.initialEvents) handle(event);
    };

    await openPanel();
    await settle(120);

    // A fresh presentation waits for the checkpoint authority to catch up, so
    // it pins a current screen rather than one that is stale by whatever was
    // still queued.
    assert.deepEqual(
      skips.map((event) => event.reason),
      [],
      "a settled fresh presentation hydrates without needing to skip anything",
    );
    assert.equal(
      skips.some(isRecoverable),
      false,
      "a gap established during hydration is never a reason to hydrate again",
    );

    h.pty.processes[0].emitData("LIVE-AFTER-HYDRATION\n");

    assert.equal(
      await waitUntil(() => rendered.join("").includes("LIVE-AFTER-HYDRATION")),
      true,
      "a hydrated terminal must stream live output",
    );
    assert.equal(attaches, 1, `hydration must not re-arm itself (attaches=${attaches})`);
  } finally {
    await h.client.close().catch(() => undefined);
    await h.task;
    await h.service.shutdown();
  }
});
