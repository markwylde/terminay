import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  ControlCapabilityStore,
  CONTROL_PROTOCOL_VERSION,
  createControlEndpoint,
  encodeControlMessage,
} from "../dist/index.js";
import {
  HeadlessPassphraseVaultAdapter,
  RemoteConnectionManager,
  RemotePairingStore,
  RemoteReconnectGrantStore,
  ServerVaultService,
  VaultServiceError,
  createRemoteReconnectProof,
} from "@terminay/server-core";

const ORIGIN = "https://session.example.test";

function deterministicBytes() {
  let sequence = 0;
  return (size) => {
    sequence += 1;
    return new Uint8Array(size).fill(sequence & 0xff);
  };
}

function proof(deviceId, ticketId, expiresAt = 2_000) {
  return {
    deviceId,
    ticketId,
    serverId: "server-a",
    sessionOrigin: ORIGIN,
    expiresAt,
    authenticated: true,
  };
}

test("local-control capabilities expire, rotate, and revoke without replay", () => {
  const clock = { value: 1_000 };
  let tokenSequence = 0;
  const capabilities = new ControlCapabilityStore({
    now: () => clock.value,
    ttlMs: 100,
    tokenFactory: () => `deterministic-token-${++tokenSequence}`,
  });

  const first = capabilities.mint("session-a", "project-a", "write");
  assert.deepEqual(capabilities.resolve(first.token), {
    terminalSessionId: "session-a",
    projectId: "project-a",
    scope: "write",
  });
  clock.value = first.expiresAt;
  assert.equal(capabilities.resolve(first.token), null);
  assert.deepEqual(capabilities.metadata(), []);

  const rotated = capabilities.rotate("session-a", "project-a", "admin");
  assert.equal(capabilities.resolve(first.token), null);
  assert.equal(capabilities.resolve(rotated.token)?.scope, "admin");
  assert.equal(capabilities.revoke(rotated.token), true);
  assert.equal(capabilities.revoke(rotated.token), false);
  assert.equal(capabilities.resolve(rotated.token), null);
});

test("local-control in-flight admission is bounded deterministically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "terminay-security-control-"));
  const socketPath = join(directory, "control.sock");
  const capabilities = new ControlCapabilityStore({ tokenFactory: () => "deterministic-control-token" });
  const lease = capabilities.mint("session-a", "project-a");
  let release;
  const endpoint = createControlEndpoint({
    socketPath,
    capabilities,
    maxInFlightPerConnection: 1,
    requestTimeoutMs: 1_000,
    dispatch: () => new Promise((_resolve, reject) => { release = () => reject(new Error("private-control-secret")); }),
  });
  await endpoint.start();
  try {
    const socket = await openSocket(socketPath);
    const responses = collectResponses(socket);
    socket.write(encodeControlMessage({ id: "first", token: lease.token, version: CONTROL_PROTOCOL_VERSION, op: "list_terminals", params: {} }));
    socket.write(encodeControlMessage({ id: "second", token: lease.token, version: CONTROL_PROTOCOL_VERSION, op: "list_terminals", params: {} }));
    const limited = await responses.next();
    assert.deepEqual(limited.value, {
      id: "second",
      ok: false,
      error: { code: "limit_exceeded", message: "The per-connection control concurrency limit was exceeded." },
    });
    release();
    const accepted = await responses.next();
    assert.deepEqual(accepted.value, { id: "first", ok: false, error: { code: "internal", message: "The control operation failed." } });
    assert.equal(JSON.stringify(accepted.value).includes("private-control-secret"), false);
    socket.destroy();
  } finally {
    await endpoint.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("pairing rooms enforce lockout, expiry, capacity, and one-time replay protection", () => {
  const clock = { value: 1_000 };
  const pairing = new RemotePairingStore({
    serverId: "server-a",
    sessionOrigin: ORIGIN,
    now: () => clock.value,
    maxRooms: 1,
    maxFailedAttempts: 3,
    defaultLifetimeMs: 20,
    maxLifetimeMs: 50,
    randomBytes: deterministicBytes(),
  });

  const locked = pairing.create();
  assert.throws(() => pairing.create(), /room limit/);
  for (let attempt = 0; attempt < 3; attempt += 1) assert.throws(() => pairing.consume({ roomId: locked.roomId, serverId: "server-a", sessionOrigin: ORIGIN, secret: "wrong-secret" }), /invalid/);
  assert.equal(pairing.metadata(locked.roomId)?.state, "locked");
  assert.throws(() => pairing.consume({ roomId: locked.roomId, serverId: "server-a", sessionOrigin: ORIGIN, secret: locked.secret }), /unavailable/);

  clock.value = locked.expiresAt + 1;
  const expired = pairing.create();
  clock.value = expired.expiresAt;
  assert.equal(pairing.metadata(expired.roomId)?.state, "expired");
  assert.throws(() => pairing.consume({ roomId: expired.roomId, serverId: "server-a", sessionOrigin: ORIGIN, secret: expired.secret }), /unavailable/);

  const oneShot = pairing.rotate();
  const admission = pairing.consume({ roomId: oneShot.roomId, serverId: "server-a", sessionOrigin: ORIGIN, secret: oneShot.secret });
  assert.equal(admission.roomId, oneShot.roomId);
  assert.equal(pairing.metadata(oneShot.roomId)?.state, "consumed");
  assert.throws(() => pairing.consume({ roomId: oneShot.roomId, serverId: "server-a", sessionOrigin: ORIGIN, secret: oneShot.secret }), /unavailable/);
});

test("remote reconnect challenges are bounded, exact-origin, single-use, expiring, and revocable", () => {
  const clock = { value: 1_000 };
  const reconnect = new RemoteReconnectGrantStore({
    serverId: "server-a",
    sessionOrigin: ORIGIN,
    now: () => clock.value,
    challengeTtlMs: 20,
    maxChallenges: 1,
    randomBytes: deterministicBytes(),
  });
  const issued = reconnect.issue({ deviceId: "device-a", lifetime: "until-revoked" });
  const pending = reconnect.createChallenge({ handle: issued.handle, origin: ORIGIN, clientNonce: "client-nonce-a" });
  assert.throws(() => reconnect.createChallenge({ handle: issued.handle, origin: ORIGIN, clientNonce: "client-nonce-b" }), /challenge limit/);
  const validProof = createRemoteReconnectProof(issued.grant, pending.signingInput);
  assert.throws(() => reconnect.verifyProof({ attemptId: pending.challenge.attemptId, handle: issued.handle, origin: "https://forged.example.test", clientNonce: "client-nonce-a", proof: validProof }), /match|origin/);
  const verified = reconnect.verifyProof({ attemptId: pending.challenge.attemptId, handle: issued.handle, origin: ORIGIN, clientNonce: "client-nonce-a", proof: validProof });
  assert.equal(verified.deviceId, "device-a");
  assert.throws(() => reconnect.verifyProof({ attemptId: pending.challenge.attemptId, handle: issued.handle, origin: ORIGIN, clientNonce: "client-nonce-a", proof: validProof }), /unavailable/);

  const expiredGrant = reconnect.issue({ deviceId: "device-b", lifetime: "1h" });
  clock.value += 60 * 60 * 1_000 + 1;
  assert.equal(reconnect.summary("device-b").status, "expired");
  assert.throws(() => reconnect.createChallenge({ handle: expiredGrant.handle, origin: ORIGIN, clientNonce: "client-nonce-c" }), /valid/);

  const revoked = reconnect.issue({ deviceId: "device-c", lifetime: "until-revoked" });
  assert.equal(reconnect.revokeDevice("device-c"), 1);
  assert.equal(reconnect.summary("device-c").status, "revoked");
  assert.throws(() => reconnect.createChallenge({ handle: revoked.handle, origin: ORIGIN, clientNonce: "client-nonce-d" }), /valid/);
});

test("remote transport rejects ticket replay/expiry and device use after revocation", () => {
  const clock = { value: 1_000 };
  const manager = new RemoteConnectionManager({ serverId: "server-a", sessionOrigin: ORIGIN, now: () => clock.value, maxPeers: 1 });
  manager.expose(1_100);
  const first = manager.admit(proof("device-a", "ticket-a", 1_050));
  assert.throws(() => manager.admit(proof("device-a", "ticket-a", 1_050)), /already been used/);
  assert.throws(() => manager.admit(proof("device-b", "ticket-b", 1_050)), /peer limit/);
  manager.revokeDevice("device-a");
  assert.throws(() => manager.send(first.peerId, "application", new Uint8Array([1])), /not connected/);
  assert.throws(() => manager.admit(proof("device-a", "ticket-c", 1_050)), /revoked/);
  clock.value = 1_100;
  assert.equal(manager.exposure.state, "disabled");
  assert.throws(() => manager.admit(proof("device-c", "ticket-expired", 1_050)), /unavailable/);
});

test("vault lock/restart revocation fences secret callbacks and keeps errors generic", async () => {
  const storage = { serialized: undefined, async read() { return this.serialized; }, async write(value) { this.serialized = value; } };
  const adapter = await HeadlessPassphraseVaultAdapter.open({ serverId: "server-a", storage, now: () => 1_000 });
  const vault = new ServerVaultService(adapter);
  const passphrase = new TextEncoder().encode("server-vault-passphrase");
  await vault.unlock({ secret: passphrase });
  await vault.put({ id: "provider.secret", value: new TextEncoder().encode("private-value") });
  await vault.restartLock();
  assert.equal(vault.status().state, "locked");
  await assert.rejects(vault.withSecret("provider.secret", () => undefined), (error) => error instanceof VaultServiceError && error.code === "locked" && !error.message.includes("private-value"));
  const wrong = new TextEncoder().encode("wrong-vault-passphrase");
  await assert.rejects(vault.unlock({ secret: wrong }), (error) => error instanceof VaultServiceError && error.code === "locked" && !error.message.includes("private-value"));
  assert.deepEqual([...wrong], new Array(wrong.length).fill(0));
  assert.equal(JSON.stringify(vault.status()).includes("private-value"), false);
});

async function openSocket(socketPath) {
  const socket = connect(socketPath);
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  return socket;
}

async function* collectResponses(socket) {
  let buffer = "";
  const queue = [];
  let wake;
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      queue.push(JSON.parse(buffer.slice(0, newline)));
      buffer = buffer.slice(newline + 1);
    }
    wake?.();
    wake = undefined;
  });
  while (true) {
    if (queue.length > 0) yield queue.shift();
    else await new Promise((resolve) => { wake = resolve; });
  }
}
