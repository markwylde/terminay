import assert from "node:assert/strict";
import test from "node:test";
import {
  RemoteApplicationGateway,
  RemoteConnectionManager,
  WorkspaceStore,
  createInitialWorkspace,
} from "../dist/index.js";

function fixture({ maxHistory = 128, maxResumeBytes = 1024 } = {}) {
  let now = 100;
  const manager = new RemoteConnectionManager({
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    now: () => now,
    maxFrameBytes: 128,
    maxQueuedBytes: 256,
  });
  manager.expose(1_000);
  const workspace = new WorkspaceStore(createInitialWorkspace("server-a"), { maxHistory });
  const viewId = workspace.state.viewOrder[0];
  assert.equal(workspace.apply({
    commandId: "project",
    expectedRevision: 0,
    command: { type: "project.create", projectId: "project-a", viewId, root: "/srv/project-a", name: "Project A" },
  }).ok, true);
  assert.equal(workspace.apply({
    commandId: "session",
    expectedRevision: 1,
    command: { type: "terminal.create", sessionId: "session-a", projectId: "project-a", createdAt: 1 },
  }).ok, true);

  const resumeCalls = [];
  const gateway = new RemoteApplicationGateway({
    manager,
    workspace,
    maxResumeBytes,
    verifier: {
      verifyDeviceKey: ({ proof, deviceKeyProof }) => proof.deviceId === "device-a" && deviceKeyProof.byteLength === 3,
      verifyPinOrApproval: ({ pinProof }) => pinProof?.byteLength === 2,
    },
    terminalResume: {
      read: ({ sessionId, projectId, fromPosition, signal }) => {
        resumeCalls.push({ sessionId, projectId, fromPosition, aborted: signal.aborted });
        return {
          sessionId,
          projectId,
          status: "running",
          fromPosition,
          nextPosition: fromPosition < 3 ? 3 : fromPosition,
          chunks: fromPosition < 3 ? [new Uint8Array([65, 66, 67])] : [],
        };
      },
    },
    now: () => now,
  });
  const request = (ticketId, overrides = {}) => ({
    proof: {
      ticketId,
      serverId: "server-a",
      sessionOrigin: "https://session.example.test",
      deviceId: "device-a",
      expiresAt: 900,
      authenticated: false,
    },
    protocolVersion: 1,
    clientNonce: "conformance-client",
    deviceKeyProof: new Uint8Array([1, 2, 3]),
    pinProof: new Uint8Array([4, 5]),
    ...overrides,
  });
  return { manager, workspace, gateway, request, resumeCalls, advance: (value) => { now = value; } };
}

function canonicalWorkspaceResume(workspace, requestedRevision) {
  const delta = workspace.delta(requestedRevision);
  const mode = delta.events.length === 0 && delta.state.revision > requestedRevision ? "snapshot" : "events";
  return {
    mode,
    requestedRevision,
    revision: delta.state.revision,
    cursor: delta.state.cursor,
    ...(mode === "snapshot" ? { state: delta.state } : {}),
    events: delta.events,
  };
}

test("remote handshake and reconnect preserve canonical workspace and terminal resume semantics", async () => {
  const fixtureValue = fixture();
  const initialCanonical = canonicalWorkspaceResume(fixtureValue.workspace, 0);
  const connection = await fixtureValue.gateway.authenticate(fixtureValue.request("ticket-a", {
    resume: {
      workspaceRevision: 0,
      terminalPositions: [{ sessionId: "session-a", projectId: "project-a", position: 0 }],
    },
  }));

  assert.deepEqual(connection.resume.workspace, initialCanonical);
  assert.deepEqual(connection.resume.terminals, [{
    sessionId: "session-a",
    projectId: "project-a",
    status: "running",
    fromPosition: 0,
    nextPosition: 3,
    chunks: [new Uint8Array([65, 66, 67])],
  }]);
  assert.deepEqual(fixtureValue.resumeCalls, [{ sessionId: "session-a", projectId: "project-a", fromPosition: 0, aborted: false }]);

  assert.equal(fixtureValue.workspace.apply({
    commandId: "view",
    expectedRevision: 2,
    command: { type: "view.create", viewId: "view-b", name: "B" },
  }).ok, true);
  const nextCanonical = canonicalWorkspaceResume(fixtureValue.workspace, 2);
  const resumed = await fixtureValue.gateway.resume(connection.peerId, {
    workspaceRevision: 2,
    terminalPositions: [{ sessionId: "session-a", projectId: "project-a", position: 3 }],
  });
  assert.deepEqual(resumed.workspace, nextCanonical);
  assert.deepEqual(resumed.terminals, [{
    sessionId: "session-a",
    projectId: "project-a",
    status: "running",
    fromPosition: 3,
    nextPosition: 3,
    chunks: [],
  }]);
  assert.deepEqual(fixtureValue.resumeCalls.at(-1), { sessionId: "session-a", projectId: "project-a", fromPosition: 3, aborted: false });

  fixtureValue.gateway.close(connection.peerId);
  assert.equal(fixtureValue.manager.snapshot().peers.length, 0);
});

test("remote resume falls back to the canonical bounded snapshot when the event window is stale", async () => {
  const fixtureValue = fixture({ maxHistory: 1 });
  const connection = await fixtureValue.gateway.authenticate(fixtureValue.request("ticket-snapshot"));
  const canonical = canonicalWorkspaceResume(fixtureValue.workspace, 0);
  assert.equal(canonical.mode, "snapshot");
  assert.deepEqual(connection.resume.workspace, canonical);
  assert.equal(connection.resume.workspace.state.serverId, "server-a");
  assert.deepEqual(connection.resume.workspace.events, []);
});

test("application conformance keeps verification and bounds before admitting a peer", async () => {
  const fixtureValue = fixture({ maxResumeBytes: 2 });
  await assert.rejects(
    fixtureValue.gateway.authenticate(fixtureValue.request("ticket-bounded", {
      resume: { terminalPositions: [{ sessionId: "session-a", projectId: "project-a", position: 0 }] },
    })),
    /byte limit/,
  );
  assert.equal(fixtureValue.manager.snapshot().peers.length, 0);
  await assert.rejects(
    fixtureValue.gateway.authenticate(fixtureValue.request("ticket-origin", {
      proof: { ...fixtureValue.request("ticket-origin").proof, sessionOrigin: "https://other.example.test" },
    })),
    /authentication failed/,
  );
  assert.equal(fixtureValue.manager.snapshot().peers.length, 0);
});
