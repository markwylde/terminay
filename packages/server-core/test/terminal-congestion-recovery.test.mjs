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

async function harness() {
  const pty = createPtyFactory();
  const checkpoints = new TerminalPresentationCheckpointAuthority();
  const service = new TerminalService({
    serverId: "server-congestion",
    ptyFactory: pty,
    generateSessionId: (() => { let n = 0; return () => `session-congestion-${++n}`; })(),
    presentationCheckpoints: checkpoints,
  });
  const session = await service.createSession({ projectId: "project-congestion", cols: 80, rows: 24 });
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
    serverId: "server-congestion",
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
      serverId: "server-congestion",
      projectId: "project-congestion",
      sessionId: session.sessionId,
    }, journal, pty, service, task, terminal,
  };
}

test("a congested terminal streams again once the client re-attaches", async () => {
  const h = await harness();
  try {
    const attachment = await h.terminal.attach({
      ...h.identity,
      clientId: "device-web",
      fromPosition: 0,
    });

    const rendered = [];
    let skips = 0;
    // A renderer acknowledges what it has painted. `stalled` models the moment
    // it stops painting - hydrating a checkpoint, a hidden tab, a slow frame.
    let stalled = false;
    const observe = (target) => {
      target.onEvent((event) => {
        if (event.type === "output") {
          rendered.push(new TextDecoder().decode(event.bytes));
          if (!stalled) void target.ack(event.nextPosition).catch(() => undefined);
        }
        if (event.type === "skip") {
          skips += 1;
          // This is what the real panel does: recover onto a fresh presentation
          // rather than trying to resume the superseded one.
          void (async () => {
            const replacement = await h.terminal.attach({
              ...h.identity,
              clientId: "device-web",
              fromPosition: 0,
              freshPresentation: true,
            }).catch(() => undefined);
            if (replacement !== undefined) observe(replacement);
          })();
        }
      });
    };
    observe(attachment);

    h.pty.processes[0].emitData("BEFORE\n");
    await settle();
    assert.equal(rendered.join("").includes("BEFORE"), true, "the attachment streams before congestion");

    // Push past the unconfirmed budget without acknowledging, exactly as a
    // renderer that has briefly stopped rendering does.
    const before = rendered.length;
    stalled = true;
    // Past the 256 KiB unconfirmed-bytes bound the pump enforces by default.
    for (let index = 0; index < 400; index += 1) h.pty.processes[0].emitData("x".repeat(1024));
    await settle(120);

    assert.equal(h.congestion.length > 0, true, "the lane congests once the unconfirmed budget is exceeded");

    // The renderer catches up and acknowledges everything it has, which is all
    // a real client can do once no further output arrives.
    stalled = false;
    await settle(60);

    h.pty.processes[0].emitData("AFTER-CONGESTION\n");
    await settle(60);

    assert.equal(
      rendered.join("").includes("AFTER-CONGESTION"),
      true,
      `a congested attachment must stream again; it stayed muted (skips=${skips}, frames=${rendered.length}, before=${before})`,
    );
  } finally {
    await h.client.close().catch(() => undefined);
    await h.task;
    await h.service.shutdown();
  }
});
