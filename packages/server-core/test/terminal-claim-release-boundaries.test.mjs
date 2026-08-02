import assert from "node:assert/strict";
import test from "node:test";
import {
  OrderedEventJournal,
  TerminalService,
  createOperationDispatcher,
  createTerminalOperationRegistry,
} from "../dist/index.js";

function ptyFactory() {
  const processes = [];
  return {
    processes,
    spawn(options) {
      const process = {
        pid: 8_000 + processes.length,
        options,
        writes: [],
        resizes: [],
        write(bytes) { this.writes.push(new Uint8Array(bytes)); },
        resize(dimensions) { this.resizes.push({ ...dimensions }); },
        kill() {},
        onData() { return () => undefined; },
        onExit() { return () => undefined; },
      };
      processes.push(process);
      return process;
    },
  };
}

function context(claims, authScope = "write") {
  return {
    connectionId: `connection-${claims?.projectId ?? "unscoped"}-${claims?.sessionId ?? "all"}`,
    clientId: "claim-client",
    authScope,
    ...(claims === undefined ? {} : { claims }),
    signal: new AbortController().signal,
  };
}

function command(dispatcher, operation, payload, commandId, claims, authScope = "write") {
  return dispatcher.command({
    envelope: { type: "command", commandId, correlationId: `${commandId}:correlation`, operation, payload },
    body: new Uint8Array(),
    context: context(claims, authScope),
  });
}

function query(dispatcher, operation, payload, claims, authScope = "read") {
  return dispatcher.query({
    envelope: { type: "query", queryId: `${operation}:${JSON.stringify(payload)}`, operation, payload },
    body: new Uint8Array(),
    context: context(claims, authScope),
  });
}

async function fixture() {
  const pty = ptyFactory();
  let nextSessionId = 0;
  const service = new TerminalService({
    serverId: "server-claims",
    ptyFactory: pty,
    generateSessionId: () => `session-${++nextSessionId}`,
  });
  const projectAOne = await service.createSession({ projectId: "project-a", cwd: "/project-a", cols: 80, rows: 24 });
  const projectATwo = await service.createSession({ projectId: "project-a", cwd: "/project-a/other", cols: 80, rows: 24 });
  const projectB = await service.createSession({ projectId: "project-b", cwd: "/project-b", cols: 80, rows: 24 });
  const registry = createTerminalOperationRegistry({ service, eventJournal: new OrderedEventJournal(), allowUnresolvedTestSessions: true });
  return {
    pty,
    service,
    registry,
    dispatcher: createOperationDispatcher(registry.operations),
    a1: projectAOne.snapshot(),
    a2: projectATwo.snapshot(),
    b: projectB.snapshot(),
  };
}

function identity(snapshot) {
  return { serverId: snapshot.serverId, projectId: snapshot.projectId, sessionId: snapshot.sessionId };
}

test("project claims constrain terminal create, list, cwd, wait, attach, and resume", async () => {
  const value = await fixture();
  const projectClaim = { projectId: "project-a" };
  try {
    const deniedCreate = await command(value.dispatcher, "terminal.create", { projectId: "project-b" }, "claim-create-other-project", projectClaim);
    assert.equal(deniedCreate.ok, false);
    assert.equal(deniedCreate.error.code, "forbidden");

    for (const [operation, payload] of [
      ["terminal.list", { projectId: "project-b" }],
      ["terminal.cwd", { projectId: "project-b", sessionId: value.b.sessionId }],
      ["terminal.wait-inactivity", { projectId: "project-b", sessionId: value.b.sessionId, durationMs: 0 }],
    ]) {
      const denied = await query(value.dispatcher, operation, payload, projectClaim);
      assert.equal(denied.envelope.ok, false, `${operation} crossed the authenticated project boundary`);
      assert.equal(denied.envelope.error.code, "forbidden");
    }

    for (const operation of ["terminal.attach", "terminal.resume"]) {
      const denied = await command(value.dispatcher, operation, {
        clientId: "claim-client",
        identity: identity(value.b),
        fromPosition: 0,
      }, `claim-${operation}-other-project`, projectClaim, "read");
      assert.equal(denied.ok, false, `${operation} crossed the authenticated project boundary`);
      assert.equal(denied.error.code, "forbidden");
    }
  } finally {
    await value.service.shutdown();
  }
});

test("session claims cannot create another terminal or observe sibling sessions", async () => {
  const value = await fixture();
  const sessionClaim = { projectId: "project-a", sessionId: value.a1.sessionId };
  try {
    const deniedCreate = await command(value.dispatcher, "terminal.create", { projectId: "project-a" }, "session-claim-create", sessionClaim);
    assert.equal(deniedCreate.ok, false);
    assert.equal(deniedCreate.error.code, "forbidden");

    const listed = await query(value.dispatcher, "terminal.list", { projectId: "project-a" }, sessionClaim);
    assert.equal(listed.envelope.ok, true);
    assert.deepEqual(listed.envelope.result.sessions.map((session) => session.sessionId), [value.a1.sessionId]);

    for (const [operation, payload] of [
      ["terminal.cwd", { projectId: "project-a", sessionId: value.a2.sessionId }],
      ["terminal.wait-inactivity", { projectId: "project-a", sessionId: value.a2.sessionId, durationMs: 0 }],
    ]) {
      const denied = await query(value.dispatcher, operation, payload, sessionClaim);
      assert.equal(denied.envelope.ok, false, `${operation} crossed the authenticated session boundary`);
      assert.equal(denied.envelope.error.code, "forbidden");
    }

    for (const operation of ["terminal.attach", "terminal.resume"]) {
      const denied = await command(value.dispatcher, operation, {
        clientId: "claim-client",
        identity: identity(value.a2),
        fromPosition: 0,
      }, `session-claim-${operation}`, sessionClaim, "read");
      assert.equal(denied.ok, false, `${operation} crossed the authenticated session boundary`);
      assert.equal(denied.error.code, "forbidden");
    }
  } finally {
    await value.service.shutdown();
  }
});

test("attachment operations recheck project and session claims on every request", async () => {
  const value = await fixture();
  const allowedClaim = { projectId: "project-a", sessionId: value.a1.sessionId };
  const mismatchedClaim = { projectId: "project-a", sessionId: value.a2.sessionId };
  try {
    const attached = await command(value.dispatcher, "terminal.attach", {
      clientId: "claim-client",
      identity: identity(value.a1),
      fromPosition: 0,
    }, "claim-attach-allowed", allowedClaim, "read");
    assert.equal(attached.ok, true);

    const shared = {
      clientId: "claim-client",
      identity: identity(value.a1),
      attachmentId: attached.result.attachmentId,
    };
    const operations = [
      ["terminal.ack", { ...shared, position: 0 }, "read"],
      ["terminal.input", { ...shared, dataBase64: "eA==" }, "write"],
      ["terminal.resize", { ...shared, cols: 100, rows: 30 }, "write"],
      ["terminal.kill", shared, "write"],
      ["terminal.detach", shared, "read"],
    ];
    for (const [index, [operation, payload, scope]] of operations.entries()) {
      const denied = await command(value.dispatcher, operation, payload, `attachment-claim-${index}`, mismatchedClaim, scope);
      assert.equal(denied.ok, false, `${operation} failed to recheck the authenticated session claim`);
      assert.equal(denied.error.code, "forbidden");
    }
    assert.equal(value.service.getSession(identity(value.a1)).status, "running");
    assert.equal(value.pty.processes[0].writes.length, 0);
    assert.equal(value.pty.processes[0].resizes.length, 0);
  } finally {
    await value.service.shutdown();
  }
});
