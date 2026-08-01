import test from "node:test";
import assert from "node:assert/strict";
import { RemoteConnectionManager } from "../dist/remote/index.js";

test("remote exposure admits authenticated server-bound peers and isolates channels", () => {
  const now = 100;
  const manager = new RemoteConnectionManager({ serverId: "srv", sessionOrigin: "https://session.example.test", now: () => now, maxFrameBytes: 4, maxQueuedBytes: 4 });
  manager.expose(200);
  const peer = manager.admit({ ticketId: "ticket-1", serverId: "srv", sessionOrigin: "https://session.example.test", deviceId: "device-1", expiresAt: 150, authenticated: true });
  manager.send(peer.peerId, "control", new Uint8Array([1, 2]));
  assert.deepEqual([...manager.drain(peer.peerId, "control")[0]], [1, 2]);
  assert.throws(() => manager.send(peer.peerId, "control", new Uint8Array([1, 2, 3, 4, 5])), /limit/);
  assert.equal(manager.snapshot().peers[0].queuedBytes, 0);
});

test("remote proofs are single-use and cross-server/unauthenticated peers are rejected", () => {
  const manager = new RemoteConnectionManager({ serverId: "srv", sessionOrigin: "https://session.example.test" });
  manager.expose(Date.now() + 1000);
  const proof = { ticketId: "ticket-1", serverId: "srv", sessionOrigin: "https://session.example.test", deviceId: "device-1", expiresAt: Date.now() + 1000, authenticated: true };
  const peer = manager.admit(proof);
  assert.throws(() => manager.admit(proof), /already been used/);
  assert.throws(() => manager.admit({ ...proof, ticketId: "ticket-2", authenticated: false }), /authenticated/);
  assert.throws(() => manager.admit({ ...proof, ticketId: "ticket-3", serverId: "other" }), /identity mismatch/);
  assert.throws(() => manager.admit({ ...proof, ticketId: "ticket-4", sessionOrigin: "https://other.example.test" }), /identity mismatch/);
  // Cross-scope failures happen before the single-use ticket ledger. A valid
  // proof with the same opaque ticket can still be admitted, so an attacker
  // cannot poison a legitimate handoff by replaying its id against another
  // server or origin first.
  const recoveredServerTicket = manager.admit({ ...proof, ticketId: "ticket-3", deviceId: "device-2" });
  const recoveredOriginTicket = manager.admit({ ...proof, ticketId: "ticket-4", deviceId: "device-3" });
  assert.equal(recoveredServerTicket.state, "connected");
  assert.equal(recoveredOriginTicket.state, "connected");
  assert.equal(manager.revokeDevice(peer.deviceId), 1);
  assert.throws(() => manager.send(peer.peerId, "application", new Uint8Array([1])), /not connected/);
});

test("revoking a device closes queued channels and rejects later connection proofs", () => {
  const now = 100;
  const manager = new RemoteConnectionManager({ serverId: "srv", sessionOrigin: "https://session.example.test", now: () => now });
  manager.expose(200);
  const proof = { ticketId: "ticket-1", serverId: "srv", sessionOrigin: "https://session.example.test", deviceId: "device-1", expiresAt: 150, authenticated: true };
  const peer = manager.admit(proof);
  manager.send(peer.peerId, "terminal", new Uint8Array([1, 2, 3]));

  assert.equal(manager.revokeDevice(peer.deviceId), 1);
  assert.equal(manager.snapshot().peers[0].state, "revoked");
  assert.equal(manager.snapshot().peers[0].queuedBytes, 0);
  assert.throws(() => manager.drain(peer.peerId, "terminal"), /not connected/);
  assert.throws(() => manager.send(peer.peerId, "terminal", new Uint8Array([4])), /not connected/);
  assert.throws(() => manager.admit({ ...proof, ticketId: "ticket-2" }), /revoked/);

});

test("fresh admissions prune terminal peer records without hiding the immediate revocation state", () => {
  let now = 100;
  const manager = new RemoteConnectionManager({ serverId: "srv", sessionOrigin: "https://session.example.test", now: () => now, maxPeers: 1 });
  manager.expose(10_000);

  for (let index = 0; index < 32; index += 1) {
    const deviceId = `device-${index}`;
    const peer = manager.admit({
      ticketId: `ticket-${index}`,
      serverId: "srv",
      sessionOrigin: "https://session.example.test",
      deviceId,
      expiresAt: 9_000,
      authenticated: true,
    });
    assert.equal(manager.revokeDevice(deviceId), 1);
    assert.deepEqual(manager.snapshot().peers.map((snapshot) => snapshot.peerId), [peer.peerId]);
    assert.equal(manager.snapshot().peers[0]?.state, "revoked");
    now += 1;
  }

  const current = manager.snapshot().peers;
  assert.equal(current.length, 1);
  assert.equal(current[0]?.deviceId, "device-31");
});

test("stopping exposure leaves existing local/server work represented and blocks new peers", () => {
  const manager = new RemoteConnectionManager({ serverId: "srv", sessionOrigin: "https://session.example.test" });
  manager.expose(Date.now() + 1000);
  manager.stopExposure();
  assert.equal(manager.snapshot().exposure.state, "disabled");
  assert.throws(() => manager.admit({ ticketId: "ticket-1", serverId: "srv", sessionOrigin: "https://session.example.test", deviceId: "device-1", expiresAt: Date.now() + 1000, authenticated: true }), /unavailable/);
});

test("expired exposure reports offline while preserving existing peer channels", () => {
  let now = 100;
  const manager = new RemoteConnectionManager({ serverId: "srv", sessionOrigin: "https://session.example.test", now: () => now });
  manager.expose(200);
  const peer = manager.admit({ ticketId: "ticket-1", serverId: "srv", sessionOrigin: "https://session.example.test", deviceId: "device-1", expiresAt: 150, authenticated: true });

  now = 200;
  assert.deepEqual(manager.exposure, { state: "disabled" });
  assert.equal(manager.snapshot().peers[0].state, "connected");
  assert.throws(() => manager.admit({ ticketId: "ticket-2", serverId: "srv", sessionOrigin: "https://session.example.test", deviceId: "device-2", expiresAt: 250, authenticated: true }), /unavailable/);
  manager.send(peer.peerId, "control", new Uint8Array([1]));
  assert.equal(manager.drain(peer.peerId, "control")[0]?.[0], 1);
});
