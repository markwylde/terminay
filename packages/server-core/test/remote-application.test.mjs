import test from "node:test";
import assert from "node:assert/strict";
import {
  RemoteApplicationGateway,
  RemoteConnectionManager,
  WorkspaceStore,
  createInitialWorkspace,
} from "../dist/index.js";

function createFixture(options = {}) {
  let now = 100;
  const manager = new RemoteConnectionManager({
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    now: () => now,
    maxFrameBytes: 64,
    maxQueuedBytes: 64,
  });
  manager.expose(1_000);
  const workspace = new WorkspaceStore(createInitialWorkspace("server-a"), { maxHistory: options.maxHistory ?? 1024 });
  const viewId = workspace.state.viewOrder[0];
  assert.equal(workspace.apply({
    commandId: "project",
    expectedRevision: 0,
    command: { type: "project.create", projectId: "project-a", viewId, root: "/tmp/project-a", name: "Project A" },
  }).ok, true);
  assert.equal(workspace.apply({
    commandId: "session",
    expectedRevision: 1,
    command: { type: "terminal.create", sessionId: "session-a", projectId: "project-a", createdAt: 1 },
  }).ok, true);
  const verifierCalls = [];
  const gateway = new RemoteApplicationGateway({
    manager,
    workspace,
    verifier: {
      verifyDeviceKey: (context) => {
        verifierCalls.push(["device", context.proof.authenticated, context.deviceKeyProof.byteLength]);
        return options.verifyDevice ?? true;
      },
      verifyPinOrApproval: (context) => {
        verifierCalls.push(["approval", context.pinProof?.byteLength ?? 0, context.approvalToken ?? null]);
        return options.verifyApproval ?? true;
      },
    },
    terminalResume: {
      read: ({ sessionId, projectId, fromPosition }) => ({
        sessionId,
        projectId,
        status: "running",
        fromPosition,
        nextPosition: fromPosition < 3 ? 3 : fromPosition,
        chunks: fromPosition < 3 ? [new Uint8Array([65, 66, 67])] : [],
      }),
    },
    maxResumeBytes: options.maxResumeBytes ?? 2 * 1024 * 1024,
    now: () => now,
  });
  const request = (ticketId = "ticket-a", overrides = {}) => ({
    proof: {
      ticketId,
      serverId: "server-a",
      sessionOrigin: "https://session.example.test",
      deviceId: "device-a",
      expiresAt: 900,
      authenticated: false,
    },
    protocolVersion: 1,
    clientNonce: "nonce-12345678",
    deviceKeyProof: new Uint8Array([1, 2, 3]),
    pinProof: new Uint8Array([4, 5]),
    ...overrides,
  });
  return { manager, workspace, gateway, request, verifierCalls, setNow: (value) => { now = value; } };
}

test("application handshake verifies device and PIN before admission and resumes workspace/terminal state", async () => {
  const fixture = createFixture();
  const connection = await fixture.gateway.authenticate(fixture.request("ticket-a", {
    resume: {
      workspaceRevision: 0,
      terminalPositions: [{ sessionId: "session-a", projectId: "project-a", position: 0 }],
    },
  }));

  assert.deepEqual(fixture.verifierCalls, [["device", false, 3], ["approval", 2, null]]);
  assert.equal(connection.protocolVersion, 1);
  assert.equal(connection.resume.workspace.mode, "events");
  assert.equal(connection.resume.workspace.revision, 2);
  assert.deepEqual(connection.resume.workspace.events.map((event) => event.revision), [1, 2]);
  assert.deepEqual([...connection.resume.terminals[0].chunks[0]], [65, 66, 67]);
  assert.equal(connection.resume.terminals[0].nextPosition, 3);
  assert.equal(fixture.manager.snapshot().peers[0].state, "connected");

  assert.equal(fixture.workspace.apply({
    commandId: "view",
    expectedRevision: 2,
    command: { type: "view.create", viewId: "view-b", name: "B" },
  }).ok, true);
  const resumed = await fixture.gateway.resume(connection.peerId, {
    workspaceRevision: 2,
    terminalPositions: [{ sessionId: "session-a", projectId: "project-a", position: 3 }],
  });
  assert.deepEqual(resumed.workspace.events.map((event) => event.revision), [3]);
  assert.equal(resumed.terminals[0].fromPosition, 3);
  assert.equal(resumed.terminals[0].nextPosition, 3);

  // Exposure controls new admission only; an already authenticated peer can
  // resume without making Local/server-owned work unavailable.
  fixture.manager.stopExposure();
  assert.equal((await fixture.gateway.resume(connection.peerId)).workspace.revision, 3);
});

test("failed device or PIN verification does not consume the connection ticket", async () => {
  const fixture = createFixture({ verifyDevice: false });
  await assert.rejects(fixture.gateway.authenticate(fixture.request()), /authentication failed/);
  assert.deepEqual(fixture.manager.snapshot().peers, []);

  const retry = createFixture();
  await assert.rejects(retry.gateway.authenticate(retry.request("ticket-retry", { pinProof: new Uint8Array() })), /PIN proof/);
  assert.deepEqual(retry.manager.snapshot().peers, []);
  const accepted = await retry.gateway.authenticate(retry.request("ticket-retry"));
  assert.equal(accepted.deviceId, "device-a");
  assert.equal(retry.manager.snapshot().peers.length, 1);
});

test("resume enforces exact terminal project scope, duplicate cursors, and bounded binary output", async () => {
  const fixture = createFixture({ maxResumeBytes: 2 });
  const connection = await fixture.gateway.authenticate(fixture.request());
  await assert.rejects(fixture.gateway.resume(connection.peerId, {
    terminalPositions: [{ sessionId: "session-a", projectId: "other-project", position: 0 }],
  }), /terminal scope/);
  await assert.rejects(fixture.gateway.resume(connection.peerId, {
    terminalPositions: [
      { sessionId: "session-a", projectId: "project-a", position: 0 },
      { sessionId: "session-a", projectId: "project-a", position: 0 },
    ],
  }), /duplicated/);
  await assert.rejects(fixture.gateway.resume(connection.peerId, {
    terminalPositions: [{ sessionId: "session-a", projectId: "project-a", position: 0 }],
  }), /byte limit/);
  assert.equal(fixture.manager.snapshot().peers[0].state, "connected");
});

test("revocation aborts the application session and rejects later resume or admission", async () => {
  const fixture = createFixture();
  const connection = await fixture.gateway.authenticate(fixture.request());
  assert.equal(fixture.gateway.revokeDevice("device-a"), 1);
  assert.throws(() => fixture.manager.send(connection.peerId, "application", new Uint8Array([1])), /not connected/);
  await assert.rejects(fixture.gateway.resume(connection.peerId), /not connected/);
  await assert.rejects(fixture.gateway.authenticate(fixture.request("ticket-new")), /authentication failed/);
  assert.equal(fixture.manager.snapshot().peers[0].state, "revoked");
});

test("application handshake bounds protocol, nonce, and device proof before admission", async () => {
  const fixture = createFixture();
  await assert.rejects(fixture.gateway.authenticate(fixture.request("ticket-version", { protocolVersion: 2 })), /incompatible/);
  await assert.rejects(fixture.gateway.authenticate(fixture.request("ticket-nonce", { clientNonce: "short" })), /nonce/);
  await assert.rejects(fixture.gateway.authenticate(fixture.request("ticket-proof", { deviceKeyProof: new Uint8Array(9 * 1024) })), /proof/);
  assert.deepEqual(fixture.manager.snapshot().peers, []);
});

test("application handshake rejects cross-server and cross-origin proofs before verifier work", async () => {
  const fixture = createFixture();

  await assert.rejects(
    fixture.gateway.authenticate(fixture.request("ticket-other-server", {
      proof: {
        ...fixture.request().proof,
        ticketId: "ticket-other-server",
        serverId: "server-b",
      },
    })),
    /remote authentication failed/,
  );
  await assert.rejects(
    fixture.gateway.authenticate(fixture.request("ticket-other-origin", {
      proof: {
        ...fixture.request().proof,
        ticketId: "ticket-other-origin",
        sessionOrigin: "https://other.example.test",
      },
    })),
    /remote authentication failed/,
  );

  assert.deepEqual(fixture.verifierCalls, []);
  assert.deepEqual(fixture.manager.snapshot().peers, []);
});

test("application handshake rejects a consumed ticket before verifier work", async () => {
  const fixture = createFixture();
  await fixture.gateway.authenticate(fixture.request("ticket-replayed"));
  const verifierCallsAfterAdmission = [...fixture.verifierCalls];

  await assert.rejects(
    fixture.gateway.authenticate(fixture.request("ticket-replayed")),
    /remote authentication failed/,
  );

  assert.deepEqual(fixture.verifierCalls, verifierCallsAfterAdmission);
  assert.equal(fixture.manager.snapshot().peers.length, 1);
});

test("resume returns a bounded canonical snapshot when the workspace delta is no longer retained", async () => {
  const fixture = createFixture({ maxHistory: 1 });
  const connection = await fixture.gateway.authenticate(fixture.request());
  assert.equal(connection.resume.workspace.mode, "snapshot");
  assert.equal(connection.resume.workspace.state?.serverId, "server-a");
  assert.equal(connection.resume.workspace.state?.revision, 2);
  assert.deepEqual(connection.resume.workspace.events, []);
});
