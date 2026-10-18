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

/**
 * A set of predicates, each re-checked whenever the test reports a change.
 * `when(predicate)` settles once it holds. Every wait in this file is on
 * something the client or server did, never on time passing.
 */
function changes() {
  const waiters = new Set();
  return {
    changed() {
      for (const waiter of [...waiters]) {
        if (!waiter.predicate()) continue;
        waiters.delete(waiter);
        waiter.resolve();
      }
    },
    when(predicate) {
      if (predicate()) return Promise.resolve();
      return new Promise((resolve) => waiters.add({ predicate, resolve }));
    },
  };
}

/**
 * The recovery retry clock. It moves only when the test moves it, so the
 * cadence is measured in time the test controls.
 */
function createManualClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  return {
    now: () => now,
    schedule(run, delayMs) {
      nextId += 1;
      const id = nextId;
      timers.set(id, { at: now + delayMs, run });
      return () => timers.delete(id);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort(([leftId, left], [rightId, right]) => left.at - right.at || leftId - rightId)[0];
        if (next === undefined) break;
        const [id, timer] = next;
        timers.delete(id);
        now = timer.at;
        timer.run();
      }
      now = target;
    },
  };
}

async function harness(options = {}) {
  const pty = createPtyFactory();
  const progress = changes();
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
    // The unconfirmed-age bound is measured on a clock that never moves, so
    // only the bytes bound - which the tests drive - can congest a lane.
    terminalDeliveryNow: () => 0,
    onTerminalCongestion: (attachmentId, clientId, connectionId) => {
      congestion.push({ attachmentId, clientId, connectionId });
      registry.suppressOutput(attachmentId, connectionId);
      progress.changed();
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
    checkpoints, congestion, client, connection, progress, identity: {
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
    const { changed, when } = h.progress;
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
          changed();
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
              changed();
            }
          })();
        }
      });
    };
    observe(attachment);

    h.pty.processes[0].emitData("BEFORE\n");
    // The attachment streams before congestion.
    await when(() => rendered.join("").includes("BEFORE"));

    // Push past the unconfirmed budget without acknowledging, exactly as a
    // renderer that has briefly stopped rendering does.
    const before = rendered.length;
    stalled = true;
    // Past the 256 KiB unconfirmed-bytes bound the pump enforces by default.
    for (let index = 0; index < 400; index += 1) h.pty.processes[0].emitData("x".repeat(1024));
    // The lane congests once the unconfirmed budget is exceeded.
    await when(() => h.congestion.length > 0);

    // The renderer catches up and acknowledges everything it has, which is all
    // a real client can do once no further output arrives.
    stalled = false;
    // Recovery is asynchronous: the skip only starts it. Wait for the
    // replacement to be in place, or this asserts against the gap in between.
    await when(() => recovered);

    h.pty.processes[0].emitData("AFTER-CONGESTION\n");

    // A congested attachment must stream again rather than stay muted.
    await when(() => rendered.join("").includes("AFTER-CONGESTION"));
    assert.ok(skips > 0 && rendered.length > before, `skips=${skips}, frames=${rendered.length}, before=${before}`);
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
  const { changed, when } = h.progress;
  const pty = h.pty.processes[0];
  // The producer answers the stream: every frame the client receives, and
  // every checkpoint a re-attach pins, is followed by more output. It never
  // falls silent while `producing`, and moves at the pace of the stream
  // rather than of a timer.
  let producing = false;
  const produce = () => { if (producing) pty.emitData("y".repeat(4096)); };
  const prepare = h.checkpoints.prepare.bind(h.checkpoints);
  // A re-attach hydrates from a checkpoint the PTY has already moved past.
  h.checkpoints.prepare = async (...args) => {
    const prepared = await prepare(...args);
    produce();
    return prepared;
  };
  try {
    const attachment = await h.terminal.attach({
      ...h.identity,
      clientId: "device-web",
      fromPosition: 0,
    });

    const rendered = [];
    let stalled = false;
    let recoveries = 0;
    let recoveredFrames = 0;
    const observe = (target, recovered) => {
      target.onEvent((event) => {
        if (event.type === "output") {
          rendered.push(new TextDecoder().decode(event.bytes));
          if (recovered) recoveredFrames += 1;
          if (!stalled) void target.ack(event.nextPosition).catch(() => undefined);
          produce();
          changed();
        }
        // A hydration boundary is not a reason to hydrate again; only a live
        // display that fell behind recovers.
        if (event.type === "skip" && event.reason !== "hydration") {
          recoveries += 1;
          changed();
          if (recoveries > 25) return;
          void h.terminal
            .attach({ ...h.identity, clientId: "device-web", fromPosition: 0, freshPresentation: true })
            .then((replacement) => { if (replacement !== undefined) observe(replacement, true); })
            .catch(() => undefined);
        }
      });
    };
    observe(attachment, false);

    stalled = true;
    producing = true;
    produce();
    // The lane congests.
    await when(() => h.congestion.length > 0);
    stalled = false;
    // The client begins recovering.
    await when(() => recoveries > 0);

    // Keep producing right through recovery, which is when a checkpoint chase
    // would show up as a terminal that never catches its own tail: a
    // recovered display must paint frame after frame while output continues.
    await when(() => recoveredFrames >= 20);

    producing = false;
    pty.emitData("CONVERGED\n");

    // A continuously producing terminal must converge.
    await when(() => rendered.join("").includes("CONVERGED"));
    assert.equal(recoveries < 25, true, `recovery must be bounded (recoveries=${recoveries})`);
  } finally {
    producing = false;
    await h.client.close().catch(() => undefined);
    await h.task;
    await h.service.shutdown();
  }
});

/**
 * Permanent overload on a slow link must skip and recover at the panel's
 * retry cadence, not spin so fast that checkpoint pins exhaust.
 *
 * The producer never yields: every lane it is given is driven past its
 * unconfirmed budget, and it keeps writing while the display waits to
 * recover. Nothing is acknowledged, modelling a link too slow to confirm.
 * Recovery uses the same 100ms retry delay as TerminalPanel, on a clock the
 * test moves. Pins are capped well below the default so a leak fails this
 * test.
 */
test("permanent overload on a slow link recovers at the retry cadence without exhausting pins", async () => {
  const RETRY_DELAY_MS = 100;
  const MAX_PINS = 3;
  const CYCLES = 5;
  const h = await harness({ maxPinsPerSession: MAX_PINS });
  const { changed, when } = h.progress;
  const clock = createManualClock();
  const pty = h.pty.processes[0];
  // Well past the 256 KiB unconfirmed-bytes bound.
  const overload = () => { for (let index = 0; index < 40; index += 1) pty.emitData("z".repeat(8192)); };
  let recovery;
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
    let attached = 0;
    let failed = 0;

    const samplePins = () => {
      const pins = h.checkpoints.session(h.identity)?.pins ?? 0;
      pinSamples.push(pins);
      if (pins > pinHighWater) pinHighWater = pins;
    };

    const observe = (target) => {
      target.onEvent((event) => {
        if (event.type === "output") {
          rendered.push(new TextDecoder().decode(event.bytes));
          changed();
        }
        if (event.type === "skip") {
          recovery.noteEvent(event);
          if (event.reason === "congestion") {
            skipStartedAt.push(clock.now());
            samplePins();
            changed();
          }
        }
      });
    };

    recovery = new TerminalRecoveryController({
      retryDelayMs: RETRY_DELAY_MS,
      schedule: clock.schedule,
      now: clock.now,
      reattach: () => {
        reattachAt.push(clock.now());
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
            attached += 1;
            changed();
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("checkpoint_limit") || message.includes("pin")) pinErrors += 1;
            recovery.noteAttachFailed();
            failed += 1;
            changed();
          });
        return "attaching";
      },
    });
    observe(attachment);

    for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
      overload();
      // Overload must skip...
      await when(() => skipStartedAt.length >= cycle);
      // ...and the producer keeps writing while the display waits.
      overload();
      // Recovery waits the retry cadence rather than spinning...
      clock.advance(RETRY_DELAY_MS - 1);
      assert.equal(reattachAt.length, cycle - 1, `recovery ${cycle} re-attached before the retry delay`);
      // ...and does not stall past it.
      clock.advance(1);
      assert.equal(reattachAt.length, cycle, `recovery ${cycle} did not re-attach at the retry delay`);
      await when(() => attached + failed >= cycle);
    }

    samplePins();
    const skipToRetry = reattachAt.map((at, index) => at - skipStartedAt[index]);
    assert.deepEqual(skipToRetry, Array(CYCLES).fill(RETRY_DELAY_MS), `recovery must keep the retry cadence (cadenceMs=${skipToRetry.join(",")})`);
    assert.equal(pinErrors, 0, `checkpoint pins must not exhaust (errors=${pinErrors}, highWater=${pinHighWater}, samples=${pinSamples.join(",")})`);
    assert.equal(failed, 0, "every re-attach must succeed");
    assert.equal(
      pinHighWater <= MAX_PINS,
      true,
      `pin churn must stay within the session cap (highWater=${pinHighWater}, cap=${MAX_PINS}, samples=${pinSamples.join(",")})`,
    );
    assert.equal(
      (h.checkpoints.session(h.identity)?.pins ?? 0) <= MAX_PINS,
      true,
      "live pins after overload must still be within the cap",
    );

    // Once the producer yields, the last recovered display streams again.
    pty.emitData("OVERLOAD-CONVERGED\n");
    await when(() => rendered.join("").includes("OVERLOAD-CONVERGED"));
  } finally {
    recovery?.dispose();
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
  const { changed, when } = h.progress;
  const pty = h.pty.processes[0];
  // The terminal produces TARGET_GAP more output while the attach is in
  // flight, between its checkpoint being pinned and its stream starting: the
  // catch-up gap the fresh presentation has to cross.
  const prepare = h.checkpoints.prepare.bind(h.checkpoints);
  h.checkpoints.prepare = async (...args) => {
    const prepared = await prepare(...args);
    pty.emitData("x".repeat(TARGET_GAP));
    return prepared;
  };
  try {
    pty.emitData("x".repeat(TARGET_GAP));

    const skips = [];
    const attachment = await h.terminal.attach({
      ...h.identity,
      clientId: "device-web",
      fromPosition: 0,
      freshPresentation: true,
    });

    const received = [];
    attachment.onEvent((event) => {
      if (event.type === "skip") skips.push(event);
      if (event.type === "output") received.push(new TextDecoder().decode(event.bytes));
      changed();
    });
    for (const event of attachment.initialEvents) {
      if (event.type === "skip") skips.push(event);
    }

    // Catch-up replay of TARGET_GAP through a 32 KiB lane would congest
    // immediately if the old 128 KiB constant still governed the bound. Output
    // written now is admitted behind everything already in flight, so once it
    // arrives - or the lane congests instead - every earlier frame has had its
    // chance to trip that. Nothing is acknowledged in between.
    pty.emitData("FENCE\n");
    await when(() => received.join("").includes("FENCE") || h.congestion.length > 0);
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
        changed();
      }
    });
    pty.emitData("LOWERED-LIMIT-LIVE\n");
    // A display that skipped catch-up must still stream live output.
    await when(() => rendered.join("").includes("LOWERED-LIMIT-LIVE"));
  } finally {
    await h.client.close().catch(() => undefined);
    await h.task;
    await h.service.shutdown();
  }
});
