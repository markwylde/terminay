import test from "node:test";
import assert from "node:assert/strict";
import { TerminayClient, TerminayClientFacade, TerminayTerminalClient, TerminalRecoveryController } from "@terminay/client-core";
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

async function harness(presentationSettleTimer) {
  const pty = createPtyFactory();
  const checkpoints = new TerminalPresentationCheckpointAuthority();
  const service = new TerminalService({
    serverId: "server-hydration",
    ptyFactory: pty,
    generateSessionId: (() => { let n = 0; return () => `session-hydration-${++n}`; })(),
    presentationCheckpoints: checkpoints,
    // Settle deadlines never pass: a fresh presentation waits for the
    // checkpoint authority to drain, however long the machine takes.
    presentationSettleTimer: presentationSettleTimer ?? { setTimeout: () => undefined, clearTimeout: () => undefined },
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
    await h.service.settlePresentation(h.identity);

    const rendered = [];
    let liveRendered;
    const live = new Promise((resolve) => { liveRendered = resolve; });
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
          if (rendered.join("").includes("LIVE-AFTER-HYDRATION")) liveRendered();
        }
        if (event.type === "skip") skips.push(event);
        if (isRecoverable(event) && attaches <= MAX) void openPanel();
      };
      attachment.onEvent(handle);
      for (const event of attachment.initialEvents) handle(event);
    };

    await openPanel();

    // A hydrated terminal must stream live output. Live output is delivered
    // behind every skip the attachment carries, and a recovery would count
    // its re-attach the moment the skip arrived, so once this has been
    // rendered everything below is final.
    h.pty.processes[0].emitData("LIVE-AFTER-HYDRATION\n");
    await live;

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
    assert.equal(attaches, 1, `hydration must not re-arm itself (attaches=${attaches})`);
  } finally {
    await h.client.close().catch(() => undefined);
    await h.task;
    await h.service.shutdown();
  }
});

test('a forced stale hydration converges to the final checkpoint after output stops', async () => {
 let forceStale = true;
 const h = await harness({ setTimeout: (finish) => { if (forceStale) queueMicrotask(finish); }, clearTimeout: () => {} });
 const timers = []; const refreshes = []; const screens = []; let attachment;
 const controller = new TerminalRecoveryController({ retryDelayMs: 100, schedule: run => { const timer = { run, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; }, reattach: () => { refreshes.push(open()); return 'attaching'; } });
 const fire = () => { for (const timer of timers.splice(0)) if (!timer.cancelled) timer.run(); };
 const gaps = [];
 async function open() {
  attachment = await h.terminal.attach({ ...h.identity, clientId: 'device-web', fromPosition: 0, freshPresentation: true });
  const handle = event => {
   controller.noteStreamProgress(event);
   if (event.type === 'skip') gaps.push(event);
   if (event.type === 'checkpoint') screens.push(new TextDecoder().decode(event.bytes));
  };
  attachment.onEvent(handle); for (const event of attachment.initialEvents) handle(event);
  controller.noteAttached();
 }
 try {
  for (let i = 0; i < 400; i++) h.pty.processes[0].emitData('x'.repeat(1024));
  h.pty.processes[0].emitData('\r\nQUIET-FINAL-MARKER\r\n');
  await open();
  // Event routing may finish in the next microtask after the command result.
  for (let i = 0; i < 100 && !gaps.length; i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(gaps.some(event => event.reason === 'hydration'));
  assert.equal(screens[0].includes('QUIET-FINAL-MARKER'), false);
  forceStale = false;
  fire(); fire(); await Promise.all(refreshes);
  assert.equal(refreshes.length, 1);
  assert.ok(screens.at(-1).includes('QUIET-FINAL-MARKER'));
  assert.equal(gaps.length, 1);
 } finally { controller.dispose(); await h.client.close(); await h.task; await h.service.shutdown(); }
});
