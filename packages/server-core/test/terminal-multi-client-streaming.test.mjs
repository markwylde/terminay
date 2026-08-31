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
 * A terminal observed by more than one device must keep streaming to all of
 * them.
 *
 * Reported from production: a web workspace was streaming, a second project
 * was created, and from then on that terminal painted its checkpoint and never
 * updated again while the panel showed "Another device is controlling this
 * terminal". The transport was healthy throughout - inbound frames and bytes
 * kept climbing with no dropped frames - so the bytes were arriving and not
 * being presented.
 *
 * Holding the presentation lease governs who may write. It must not govern who
 * receives output: a read-only observer is still a display.
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
  let sessions = 0;
  const service = new TerminalService({
    serverId: "server-multi",
    ptyFactory: pty,
    generateSessionId: () => `session-multi-${++sessions}`,
    presentationCheckpoints: checkpoints,
  });
  const journal = new OrderedEventJournal();
  const registry = createTerminalOperationRegistry({
    service,
    eventJournal: journal,
    checkpoints,
    allowUnresolvedTestSessions: true,
  });
  const congestion = [];
  const core = createServerCore({
    serverId: "server-multi",
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
  });

  const devices = [];
  const connect = async (clientId) => {
    const pair = createInMemoryTransportPair();
    const connection = core.accept(pair.server);
    const task = connection.start().catch(() => undefined);
    const client = new TerminayClient({ transport: pair.client, clientId, capabilities: ["terminal", "events.resync"] });
    const facade = new TerminayClientFacade(client);
    const terminal = new TerminayTerminalClient({
      command: facade.command.bind(facade),
      subscribe: client.subscribe.bind(client),
      queryWithBody: client.queryWithBody.bind(client),
    });
    await pair.open();
    await client.connect();
    const device = { client, clientId, task, terminal };
    devices.push(device);
    return device;
  };

  return {
    congestion, connect, devices, journal, pty, service,
    identityFor: (session) => ({
      serverId: "server-multi",
      projectId: session.projectId,
      sessionId: session.sessionId,
    }),
    async close() {
      for (const device of devices) await device.client.close().catch(() => undefined);
      for (const device of devices) await device.task;
      await service.shutdown();
    },
  };
}

/** Collect rendered output for one attachment. */
function observe(attachment, sink) {
  attachment.onEvent((event) => {
    if (event.type === "output") sink.push(new TextDecoder().decode(event.bytes));
  });
}

test("a read-only observer keeps streaming while another device holds the lease", async () => {
  const h = await harness();
  try {
    const session = await h.service.createSession({ projectId: "project-one", cols: 80, rows: 24 });
    const identity = h.identityFor(session);

    const desktop = await h.connect("device-desktop");
    const web = await h.connect("device-web");

    const desktopAttachment = await desktop.terminal.attach({ ...identity, clientId: "device-desktop", fromPosition: 0 });
    const webAttachment = await web.terminal.attach({ ...identity, clientId: "device-web", fromPosition: 0 });

    // The first write-authorized surface owns the presentation; the second is
    // an observer. That governs writes, not delivery.
    assert.equal(desktopAttachment.presentation.role, "controller");
    assert.equal(webAttachment.presentation.role, "read_only");

    const desktopOutput = [];
    const webOutput = [];
    observe(desktopAttachment, desktopOutput);
    observe(webAttachment, webOutput);

    h.pty.processes[0].emitData("STREAMED-TO-BOTH\n");
    await settle();

    assert.equal(desktopOutput.join("").includes("STREAMED-TO-BOTH"), true,
      "the controlling device streams");
    assert.equal(webOutput.join("").includes("STREAMED-TO-BOTH"), true,
      "a read-only observer is still a display and must receive live output");
  } finally {
    await h.close();
  }
});

test("creating a second project does not stop an existing terminal from streaming", async () => {
  const h = await harness();
  try {
    const first = await h.service.createSession({ projectId: "project-one", cols: 80, rows: 24 });
    const firstIdentity = h.identityFor(first);

    const desktop = await h.connect("device-desktop");
    const web = await h.connect("device-web");
    await desktop.terminal.attach({ ...firstIdentity, clientId: "device-desktop", fromPosition: 0 });
    const webFirst = await web.terminal.attach({ ...firstIdentity, clientId: "device-web", fromPosition: 0 });

    const webOutput = [];
    observe(webFirst, webOutput);

    h.pty.processes[0].emitData("BEFORE-SECOND-PROJECT\n");
    await settle();
    assert.equal(webOutput.join("").includes("BEFORE-SECOND-PROJECT"), true,
      "the terminal streams before the second project exists");

    // Exactly what the user did: a second project with its own terminal, which
    // both devices also attach to.
    const second = await h.service.createSession({ projectId: "project-two", cols: 80, rows: 24 });
    const secondIdentity = h.identityFor(second);
    await desktop.terminal.attach({ ...secondIdentity, clientId: "device-desktop", fromPosition: 0 });
    const webSecond = await web.terminal.attach({ ...secondIdentity, clientId: "device-web", fromPosition: 0 });
    const secondOutput = [];
    observe(webSecond, secondOutput);
    await settle();

    h.pty.processes[0].emitData("AFTER-SECOND-PROJECT\n");
    h.pty.processes[1].emitData("SECOND-PROJECT-OUTPUT\n");
    await settle();

    assert.equal(secondOutput.join("").includes("SECOND-PROJECT-OUTPUT"), true,
      "the new project's terminal streams");
    assert.equal(
      webOutput.join("").includes("AFTER-SECOND-PROJECT"),
      true,
      "the original terminal must keep streaming after a second project is created",
    );
  } finally {
    await h.close();
  }
});
