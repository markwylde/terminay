import assert from "node:assert/strict";
import test from "node:test";
import {
  RemoteConnectionManager,
  RemoteExposureController,
  RemotePairingStore,
} from "../dist/remote/index.js";


function fixture() {
  let now = 100;
  let entropy = 0;
  const manager = new RemoteConnectionManager({
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    now: () => now,
  });
  const pairing = new RemotePairingStore({
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    now: () => now,
    randomBytes: (size) => Uint8Array.from({ length: size }, () => ++entropy),
  });
  const controller = new RemoteExposureController({ manager, pairing, now: () => now, defaultLifetimeMs: 200 });
  return { controller, manager, pairing, advance: (value) => { now = value; } };
}

test("exposure starts, rotates, and stops pairing material without exposing secrets in status", () => {
  const { controller, pairing } = fixture();
  const first = controller.start(300);
  assert.equal(controller.status.exposure.state, "exposed");
  assert.equal(controller.status.pairing.roomId, first.roomId);
  assert.equal(new URL(first.pairingUrl).hash.slice(1), first.secret);
  assert.equal(JSON.stringify(controller.status).includes(first.secret), false);

  const extra = controller.createPairing(290);
  assert.notEqual(extra.roomId, first.roomId);
  const rotated = controller.rotate(400);
  assert.notEqual(rotated.roomId, extra.roomId);
  assert.equal(controller.status.pairing.roomId, rotated.roomId);
  assert.equal(pairing.metadata(extra.roomId), undefined);

  const stopped = controller.stopExposure();
  assert.equal(stopped.exposure.state, "disabled");
  assert.equal(stopped.pairing, undefined);
  assert.throws(() => controller.createPairing(), /not active/);
  assert.throws(() => pairing.consume({ roomId: rotated.roomId, serverId: "server-a", sessionOrigin: "https://session.example.test", secret: rotated.secret }), /unavailable/);
});

test("stopping exposure blocks new pairing but preserves admitted peers", () => {
  const { controller, manager } = fixture();
  const handoff = controller.start(500);
  const attempt = { roomId: handoff.roomId, serverId: handoff.serverId, sessionOrigin: handoff.sessionOrigin, secret: handoff.secret };
  controller.consumePairing(attempt);
  const peer = manager.admit({
    ticketId: "ticket-a",
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    deviceId: "device-a",
    expiresAt: 450,
    authenticated: true,
  });

  // Stopping exposure withdraws the door, never the people already inside:
  // server-owned work continues for peers that were already admitted.
  controller.stopExposure();
  assert.equal(controller.status.exposure.state, "disabled");
  assert.deepEqual(manager.snapshot().peers.map((entry) => entry.deviceId), ["device-a"]);
  assert.equal(manager.snapshot().peers[0].state, "connected");

  // A one-time room cannot be replayed once exposure has stopped.
  assert.throws(() => controller.consumePairing(attempt), /not active|pairing/i);
  manager.closePeer(peer.peerId);
});

test("controller refuses identity mismatches and expired exposure cannot admit new pairing", () => {
  assert.throws(() => new RemoteExposureController({
    manager: new RemoteConnectionManager({ serverId: "server-a", sessionOrigin: "https://a.example.test" }),
    pairing: new RemotePairingStore({ serverId: "server-b", sessionOrigin: "https://b.example.test" }),
  }), /identity/);
  const fixtureValue = fixture();
  fixtureValue.controller.start(300);
  fixtureValue.advance(300);
  assert.equal(fixtureValue.controller.status.exposure.state, "disabled");
  assert.throws(() => fixtureValue.controller.createPairing(), /not active/);
});
