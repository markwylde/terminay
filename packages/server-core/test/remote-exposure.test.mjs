import assert from "node:assert/strict";
import test from "node:test";
import {
  RemoteConnectionManager,
  RemoteExposureController,
  RemoteHeadlessWebRtcFactory,
  RemotePairingStore,
} from "../dist/remote/index.js";

class FakeChannel {
  constructor(label) {
    this.label = label;
    this.readyState = "open";
    this.bufferedAmount = 0;
    this.messages = new Set();
    this.states = new Set();
  }
  send() {}
  close() {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    for (const listener of [...this.states]) listener("closed");
  }
  onMessage(listener) {
    this.messages.add(listener);
    return () => this.messages.delete(listener);
  }
  onStateChange(listener) {
    this.states.add(listener);
    return () => this.states.delete(listener);
  }
}

function fixture({ withHeadless = false } = {}) {
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
  const channels = new Map(["control", "application", "terminal", "assets"].map((label) => [label, new FakeChannel(label)]));
  const headless = withHeadless
    ? new RemoteHeadlessWebRtcFactory({
        manager,
        runtimes: [{ runtime: "custom", connect: async () => channels }],
      })
    : undefined;
  const controller = new RemoteExposureController({ manager, pairing, headless, now: () => now, defaultLifetimeMs: 200 });
  return { controller, manager, pairing, channels, advance: (value) => { now = value; } };
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

test("one-time pairing admits a headless session and stop exposure preserves existing work", async () => {
  const { controller, manager, channels } = fixture({ withHeadless: true });
  const handoff = controller.start(500);
  const proof = {
    ticketId: "ticket-a",
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    deviceId: "device-a",
    expiresAt: 450,
    authenticated: true,
  };
  const attempt = { roomId: handoff.roomId, serverId: handoff.serverId, sessionOrigin: handoff.sessionOrigin, secret: handoff.secret };
  const session = await controller.connectHeadless("custom", attempt, proof);
  assert.equal(controller.status.sessions.length, 1);
  controller.stopExposure();
  assert.equal(session.state, "connected");
  assert.equal(manager.snapshot().peers[0].state, "connected");
  assert.equal(channels.get("control").readyState, "open");
  await assert.rejects(controller.connectHeadless("custom", attempt, { ...proof, ticketId: "ticket-b" }), /not active|unavailable/);
  await controller.shutdown();
  assert.equal(session.state, "closed");
  assert.equal(manager.snapshot().peers.length, 0);
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
