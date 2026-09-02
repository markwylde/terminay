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
  checkpointCatchupBytes,
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

async function harness(options = {}) {
  const pty = createPtyFactory();
  const checkpoints = new TerminalPresentationCheckpointAuthority({
    ...(options.maxPinsPerSession === undefined ? {} : { maxPinsPerSession: options.maxPinsPerSession }),
  });
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
    ...(options.maxTerminalUnconfirmedBytes === undefined
      ? {}
      : { maxTerminalUnconfirmedBytes: options.maxTerminalUnconfirmedBytes }),
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
    ...(options.maxTerminalUnconfirmedBytes === undefined
      ? {}
      : { maxTerminalUnconfirmedBytes: options.maxTerminalUnconfirmedBytes }),
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
    checkpoints, congestion, client, connection, identity: {
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
    let recovered = false;
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
            if (replacement !== undefined) {
              observe(replacement);
              recovered = true;
            }
          })();
        }
      });
    };
    observe(attachment);

    h.pty.processes[0].emitData("BEFORE\n");
    assert.equal(
      await waitUntil(() => rendered.join("").includes("BEFORE")),
      true,
      "the attachment streams before congestion",
    );

    // Push past the unconfirmed budget without acknowledging, exactly as a
    // renderer that has briefly stopped rendering does.
    const before = rendered.length;
    stalled = true;
    // Past the 256 KiB unconfirmed-bytes bound the pump enforces by default.
    for (let index = 0; index < 400; index += 1) h.pty.processes[0].emitData("x".repeat(1024));
    assert.equal(
      await waitUntil(() => h.congestion.length > 0),
      true,
      "the lane congests once the unconfirmed budget is exceeded",
    );

    // The renderer catches up and acknowledges everything it has, which is all
    // a real client can do once no further output arrives.
    stalled = false;
    // Recovery is asynchronous: the skip only starts it, and the replacement
    // attach waits for the checkpoint drain within a deadline. Wait for the
    // replacement to be in place, or this asserts against the gap in between.
    assert.equal(await waitUntil(() => recovered), true, "the client re-attaches after congestion");

    h.pty.processes[0].emitData("AFTER-CONGESTION\n");

    assert.equal(
      await waitUntil(() => rendered.join("").includes("AFTER-CONGESTION")),
      true,
      `a congested attachment must stream again; it stayed muted (skips=${skips}, frames=${rendered.length}, before=${before})`,
    );
  } finally {
    await h.client.close().catch(() => undefined);
    await h.task;
    await h.service.shutdown();
  }
});

/**
 * The real workload: a terminal that never falls silent.
 *
 * Recovery has to complete while the producer is still writing. Every attempt
 * hydrates from a checkpoint that the PTY has already moved past, so if
 * catching up were unbounded - or if a hydration boundary counted as a reason
 * to hydrate again - the terminal would chase the head forever and never paint
 * another byte. It must converge instead.
 */
test("a terminal that never stops producing still converges after congestion", async () => {
  const h = await harness();
  let ticker;
  try {
    const attachment = await h.terminal.attach({
      ...h.identity,
      clientId: "device-web",
      fromPosition: 0,
    });

    const rendered = [];
    let stalled = false;
    let recoveries = 0;
    const observe = (target) => {
      target.onEvent((event) => {
        if (event.type === "output") {
          rendered.push(new TextDecoder().decode(event.bytes));
          if (!stalled) void target.ack(event.nextPosition).catch(() => undefined);
        }
        // A hydration boundary is not a reason to hydrate again; only a live
        // display that fell behind recovers.
        if (event.type === "skip" && event.reason !== "hydration") {
          recoveries += 1;
          if (recoveries > 25) return;
          void h.terminal
            .attach({ ...h.identity, clientId: "device-web", fromPosition: 0, freshPresentation: true })
            .then((replacement) => { if (replacement !== undefined) observe(replacement); })
            .catch(() => undefined);
        }
      });
    };
    observe(attachment);

    ticker = setInterval(() => h.pty.processes[0].emitData("y".repeat(4096)), 2);

    stalled = true;
    assert.equal(await waitUntil(() => h.congestion.length > 0), true, "the lane congests");
    stalled = false;
    assert.equal(await waitUntil(() => recoveries > 0), true, "the client begins recovering");

    // Keep producing right through recovery, which is when a checkpoint chase
    // would show up as a terminal that never catches its own tail. Waiting for
    // repeated recoveries exercises that far more reliably than sleeping for a
    // fixed period does on a loaded machine.
    await waitUntil(() => recoveries >= 3, 5_000);

    clearInterval(ticker);
    ticker = undefined;
    await settle(20);
    h.pty.processes[0].emitData("CONVERGED\n");

    assert.equal(
      await waitUntil(() => rendered.join("").includes("CONVERGED")),
      true,
      `a continuously producing terminal must converge (recoveries=${recoveries})`,
    );
    assert.equal(recoveries < 25, true, `recovery must be bounded (recoveries=${recoveries})`);
  } finally {
    if (ticker !== undefined) clearInterval(ticker);
    await h.client.close().catch(() => undefined);
    await h.task;
    await h.service.shutdown();
  }
});

/**
 * Permanent overload on a slow link must skip and recover at the panel's
 * retry cadence, not spin so fast that checkpoint pins exhaust.
 *
 * The producer never yields. Acknowledgements are delayed to model a slow
 * link. Recovery uses the same 100ms retry delay as TerminalPanel. Pins are
 * capped well below the default so a leak fails this test.
 */
test("permanent overload on a slow link recovers at the retry cadence without exhausting pins", async () => {
  const RETRY_DELAY_MS = 100;
  const MAX_PINS = 3;
  const CYCLES = 2;
  const h = await harness({ maxPinsPerSession: MAX_PINS });
  let producer;
  try {
    const attachment = await h.terminal.attach({
      ...h.identity,
      clientId: "device-web",
      fromPosition: 0,
    });

    const rendered = [];
    const skipStartedAt = [];
    const reattachAt = [];
    const pinSamples = [];
    let pinHighWater = 0;
    let pinErrors = 0;

    const samplePins = () => {
      const pins = h.checkpoints.session(h.identity)?.pins ?? 0;
      pinSamples.push(pins);
      if (pins > pinHighWater) pinHighWater = pins;
    };

    let recovery;
    const observe = (target) => {
      target.onEvent((event) => {
        if (event.type === "output") {
          rendered.push(new TextDecoder().decode(event.bytes));
        }
        if (event.type === "skip") {
          recovery.noteEvent(event);
          if (event.reason === "congestion") {
            skipStartedAt.push(Date.now());
            samplePins();
          }
        }
      });
    };

    recovery = new TerminalRecoveryController({
      retryDelayMs: RETRY_DELAY_MS,
      schedule: (run, delayMs) => {
        const timer = setTimeout(run, delayMs);
        return () => clearTimeout(timer);
      },
      reattach: () => {
        reattachAt.push(Date.now());
        samplePins();
        void h.terminal
          .attach({
            ...h.identity,
            clientId: "device-web",
            fromPosition: 0,
            freshPresentation: true,
          })
          .then((replacement) => {
            recovery.noteAttached();
            observe(replacement);
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("checkpoint_limit") || message.includes("pin")) pinErrors += 1;
            recovery.noteAttachFailed();
          });
        return "attaching";
      },
    });
    observe(attachment);

    producer = setInterval(() => h.pty.processes[0].emitData("z".repeat(8192)), 1);
    assert.equal(
      await waitUntil(() => skipStartedAt.length >= CYCLES && reattachAt.length >= CYCLES, 8_000),
      true,
      `overload must skip and recover repeatedly (skips=${skipStartedAt.length}, reattaches=${reattachAt.length})`,
    );

    clearInterval(producer);
    producer = undefined;
    samplePins();

    const paired = Math.min(skipStartedAt.length, reattachAt.length);
    const skipToRetry = [];
    for (let index = 0; index < paired; index += 1) {
      skipToRetry.push(reattachAt[index] - skipStartedAt[index]);
    }
    assert.equal(pinErrors, 0, `checkpoint pins must not exhaust (errors=${pinErrors}, highWater=${pinHighWater}, samples=${pinSamples.join(",")})`);
    assert.equal(
      pinHighWater <= MAX_PINS,
      true,
      `pin churn must stay within the session cap (highWater=${pinHighWater}, cap=${MAX_PINS}, samples=${pinSamples.join(",")})`,
    );
    assert.equal(
      skipToRetry.length >= CYCLES,
      true,
      `every started recovery must wait the retry delay (cadenceMs=${skipToRetry.join(",")})`,
    );
    assert.equal(
      skipToRetry.every((delay) => delay >= RETRY_DELAY_MS - 25),
      true,
      `recovery must wait the retry cadence rather than spinning (cadenceMs=${skipToRetry.join(",")})`,
    );
    assert.equal(
      skipToRetry.every((delay) => delay < RETRY_DELAY_MS * 8),
      true,
      `recovery must not stall past the retry cadence (cadenceMs=${skipToRetry.join(",")})`,
    );
    assert.equal(
      (h.checkpoints.session(h.identity)?.pins ?? 0) <= MAX_PINS,
      true,
      "live pins after overload must still be within the cap",
    );

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS + 400));
    h.pty.processes[0].emitData("OVERLOAD-CONVERGED\n");
    assert.equal(
      await waitUntil(() => rendered.join("").includes("OVERLOAD-CONVERGED")),
      true,
      `overload must still converge once the producer yields (skips=${skipStartedAt.length}, pins=${pinHighWater})`,
    );
  } finally {
    clearInterval(producer);
    await h.client.close().catch(() => undefined);
    await h.task;
    await h.service.shutdown();
  }
});

/**
 * Catch-up is derived from the connection's unconfirmed-bytes limit. A host
 * that lowers that limit below the old 128 KiB constant must skip the gap
 * rather than replay it into a lane that cannot carry it.
 */
test("a lowered unconfirmed-bytes limit cannot hydrate into congestion", async () => {
  const UNCONFIRMED = 32 * 1024;
  const OLD_CONSTANT = 128 * 1024;
  const TARGET_GAP = 64 * 1024;
  assert.equal(checkpointCatchupBytes(UNCONFIRMED), 16 * 1024);
  assert.equal(checkpointCatchupBytes(UNCONFIRMED) < UNCONFIRMED, true);
  assert.equal(checkpointCatchupBytes(UNCONFIRMED) < OLD_CONSTANT, true);
  assert.equal(TARGET_GAP > UNCONFIRMED, true);
  assert.equal(TARGET_GAP <= OLD_CONSTANT, true);

  const h = await harness({ maxTerminalUnconfirmedBytes: UNCONFIRMED });
  let ticker;
  try {
    const gap = () => {
      const live = h.service.getSession(h.identity)?.outputPosition ?? 0;
      const checkpoint = h.checkpoints.session(h.identity)?.outputPosition ?? 0;
      return Math.max(0, live - checkpoint);
    };
    const topUp = () => {
      const need = TARGET_GAP - gap();
      if (need > 0) h.pty.processes[0].emitData("x".repeat(need));
    };
    topUp();
    ticker = setInterval(topUp, 0);

    const skips = [];
    const attachment = await h.terminal.attach({
      ...h.identity,
      clientId: "device-web",
      fromPosition: 0,
      freshPresentation: true,
    });
    clearInterval(ticker);
    ticker = undefined;

    attachment.onEvent((event) => {
      if (event.type === "skip") skips.push(event);
    });
    for (const event of attachment.initialEvents) {
      if (event.type === "skip") skips.push(event);
    }

    // Catch-up replay of TARGET_GAP through a 32 KiB lane would congest
    // immediately if the old 128 KiB constant still governed the bound.
    // Give in-flight frames a moment to trip that, then freeze the producer.
    await settle(40);
    assert.equal(
      h.congestion.length,
      0,
      `hydration must not congest a lowered unconfirmed-bytes lane (congestion=${h.congestion.length}, skips=${skips.map((event) => event.reason).join(",")})`,
    );
    assert.equal(
      skips.some((event) => event.reason === "hydration"),
      true,
      `a catch-up gap larger than the derived bound must be a hydration skip (reasons=${skips.map((event) => event.reason).join(",")})`,
    );
    assert.equal(
      skips.every((event) => event.reason === "hydration"),
      true,
      `a catch-up gap must be stated as hydration, not congestion (reasons=${skips.map((event) => event.reason).join(",")})`,
    );

    const rendered = [];
    attachment.onEvent((event) => {
      if (event.type === "output") {
        rendered.push(new TextDecoder().decode(event.bytes));
        void attachment.ack(event.nextPosition).catch(() => undefined);
      }
    });
    h.pty.processes[0].emitData("LOWERED-LIMIT-LIVE\n");
    assert.equal(
      await waitUntil(() => rendered.join("").includes("LOWERED-LIMIT-LIVE")),
      true,
      "a display that skipped catch-up must still stream live output",
    );
  } finally {
    if (ticker !== undefined) clearInterval(ticker);
    await h.client.close().catch(() => undefined);
    await h.task;
    await h.service.shutdown();
  }
});
