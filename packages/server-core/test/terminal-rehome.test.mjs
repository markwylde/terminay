import assert from "node:assert/strict";
import test from "node:test";
import {
  DetachableTerminalConsumerRegistry,
  OrderedEventJournal,
  TerminalInputSourceAdapter,
  TerminalPresentationCheckpointAuthority,
  TerminalPresentationLeaseAuthority,
  TerminalService,
  createOperationDispatcher,
  createTerminalOperationRegistry,
} from "../dist/index.js";

function createPtyFactory() {
  const processes = [];
  return {
    processes,
    spawn(options) {
      const dataListeners = new Set();
      const process = {
        pid: 9_500 + processes.length,
        options,
        writes: [],
        write(bytes) { this.writes.push(new Uint8Array(bytes)); },
        resize() {},
        kill() {},
        onData(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener); },
        onExit() { return () => undefined; },
        emitData(value) { const bytes = new TextEncoder().encode(value); for (const listener of dataListeners) listener(bytes); },
      };
      processes.push(process);
      return process;
    },
  };
}

function request(operation, payload, commandId, clientId = "client-a") {
  return {
    envelope: { type: "command", commandId, correlationId: `${commandId}-correlation`, operation, payload },
    body: new Uint8Array(),
    context: { connectionId: `connection-${clientId}`, clientId, authScope: "write", signal: new AbortController().signal },
  };
}

function nextTurn() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const SOURCE = { serverId: "server-a", projectId: "project-a", sessionId: "session-a" };
const TARGET = { ...SOURCE, projectId: "project-b" };

async function fixture() {
  const pty = createPtyFactory();
  const checkpoints = new TerminalPresentationCheckpointAuthority();
  const service = new TerminalService({
    serverId: "server-a",
    ptyFactory: pty,
    generateSessionId: () => "session-a",
    presentationCheckpoints: checkpoints,
  });
  await service.createSession({ projectId: "project-a", cols: 80, rows: 24 });
  const journal = new OrderedEventJournal();
  const events = [];
  journal.subscribe((event) => events.push(event.payload));
  const presentations = new TerminalPresentationLeaseAuthority();
  const inputSources = new TerminalInputSourceAdapter(service);
  const consumers = new DetachableTerminalConsumerRegistry(service);
  const registry = createTerminalOperationRegistry({
    service,
    eventJournal: journal,
    presentations,
    inputSources,
    checkpoints,
    allowUnresolvedTestSessions: true,
  });
  /** What the composition does when a terminal panel move commits. */
  const rehome = () => {
    registry.retireIdentity(SOURCE);
    consumers.detachSession(SOURCE);
    return service.rehomeSession("session-a", "project-b");
  };
  return { pty, service, checkpoints, presentations, inputSources, consumers, registry, events, rehome, dispatcher: createOperationDispatcher(registry.operations) };
}

test("a re-homed terminal keeps its PTY, session id, and output position under the target project", async () => {
  const value = await fixture();
  try {
    value.pty.processes[0].emitData("before the move");
    await nextTurn();
    const before = value.service.getSession("session-a");

    assert.deepEqual(value.rehome(), SOURCE);

    const after = value.service.getSession("session-a");
    assert.equal(after.projectId, "project-b");
    assert.equal(after.sessionId, before.sessionId);
    assert.equal(after.outputPosition, before.outputPosition);
    assert.equal(after.pid, before.pid);
    assert.equal(value.pty.processes.length, 1);
    assert.equal(value.service.listSessions().length, 1);

    value.pty.processes[0].emitData(" and after");
    await nextTurn();
    assert.equal(value.service.getSession("session-a").outputPosition, before.outputPosition + " and after".length);
  } finally {
    await value.service.shutdown();
  }
});

test("re-homing is a no-op for an unknown session or the project it is already in", async () => {
  const value = await fixture();
  try {
    assert.equal(value.service.rehomeSession("session-missing", "project-b"), undefined);
    assert.equal(value.service.rehomeSession("session-a", "project-a"), undefined);
    assert.equal(value.service.getSession("session-a").projectId, "project-a");
  } finally {
    await value.service.shutdown();
  }
});

test("nothing bound to the retired identity survives a re-home", async () => {
  const value = await fixture();
  try {
    const attached = await value.dispatcher.command(request("terminal.attach", { clientId: "client-a", identity: SOURCE, fromPosition: 0 }, "attach-source"));
    assert.equal(attached.ok, true);
    const attachmentId = attached.result.attachmentId;
    const resized = await value.dispatcher.command(request("terminal.resize", { clientId: "client-a", identity: SOURCE, attachmentId, cols: 100, rows: 30 }, "resize-source"));
    assert.equal(resized.ok, true);
    value.consumers.attach(SOURCE, "consumer-a");
    await value.checkpoints.prepare({ ...SOURCE, clientId: "client-a" }, { clientId: "client-a" }).catch(() => undefined);

    assert.notEqual(value.presentations.state(SOURCE).holder, undefined);
    assert.notEqual(value.inputSources.getResizeOwnership(SOURCE), undefined);
    assert.equal(value.consumers.isAttached(SOURCE, "consumer-a"), true);

    value.rehome();

    assert.equal(value.presentations.state(SOURCE).holder, undefined);
    assert.equal(value.presentations.state(SOURCE).revision, 0);
    assert.equal(value.inputSources.getResizeOwnership(SOURCE), undefined);
    assert.equal(value.consumers.isAttached(SOURCE, "consumer-a"), false);
    assert.equal(value.checkpoints.session(SOURCE), undefined);
    assert.notEqual(value.checkpoints.session(TARGET), undefined);
    assert.equal(value.registry.presentationHolder(SOURCE), undefined);

    // The client is told its stream ended rather than left waiting on it.
    const closed = value.events.find((event) => event.attachmentId === attachmentId && event.type === "skip" && event.reason === "attachment_closed");
    assert.notEqual(closed, undefined);

    for (const [operation, payload] of [
      ["terminal.input", { clientId: "client-a", identity: SOURCE, attachmentId, dataBase64: "aGk=" }],
      ["terminal.resize", { clientId: "client-a", identity: SOURCE, attachmentId, cols: 90, rows: 20 }],
      ["terminal.detach", { clientId: "client-a", identity: SOURCE, attachmentId }],
      ["terminal.attach", { clientId: "client-a", identity: SOURCE, fromPosition: 0 }],
    ]) {
      const refused = await value.dispatcher.command(request(operation, payload, `retired-${operation}`));
      assert.equal(refused.ok, false, `${operation} was accepted under the retired identity`);
    }
    assert.equal(value.pty.processes[0].writes.length, 0);
  } finally {
    await value.service.shutdown();
  }
});

test("a client attaches again under the target identity and resumes from retained output", async () => {
  const value = await fixture();
  try {
    const first = await value.dispatcher.command(request("terminal.attach", { clientId: "client-a", identity: SOURCE, fromPosition: 0 }, "attach-source"));
    assert.equal(first.ok, true);
    value.pty.processes[0].emitData("retained");
    await nextTurn();

    value.rehome();

    const again = await value.dispatcher.command(request("terminal.attach", { clientId: "client-a", identity: TARGET, fromPosition: 0 }, "attach-target"));
    assert.equal(again.ok, true);
    assert.notEqual(again.result.attachmentId, first.result.attachmentId);
    assert.equal(again.result.presentation.role, "controller");
    const replayed = again.result.events
      .filter((event) => event.type === "output")
      .map((event) => Buffer.from(event.bytes, "base64").toString())
      .join("");
    assert.equal(replayed, "retained");

    const input = await value.dispatcher.command(request("terminal.input", { clientId: "client-a", identity: TARGET, attachmentId: again.result.attachmentId, dataBase64: "aGk=" }, "input-target"));
    assert.equal(input.ok, true);
    await nextTurn();
    assert.equal(value.pty.processes[0].writes.length, 1);
  } finally {
    await value.service.shutdown();
  }
});

test("project-scoped reads report a re-homed terminal under the target project only", async () => {
  const value = await fixture();
  try {
    value.rehome();
    const list = (projectId) => value.dispatcher.query({
      envelope: { type: "query", queryId: `list-${projectId}`, operation: "terminal.list", payload: { projectId } },
      body: new Uint8Array(),
      context: { connectionId: "connection-client-a", clientId: "client-a", authScope: "read", signal: new AbortController().signal },
    });
    const source = await list("project-a");
    const target = await list("project-b");
    assert.deepEqual(source.envelope.result.sessions.map((session) => session.sessionId), []);
    assert.deepEqual(target.envelope.result.sessions.map((session) => session.sessionId), ["session-a"]);
  } finally {
    await value.service.shutdown();
  }
});
