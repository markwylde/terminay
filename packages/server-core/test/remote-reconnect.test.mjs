import assert from "node:assert/strict";
import test from "node:test";
import {
  RemoteReconnectGrantStore,
  createRemoteReconnectProof,
} from "../dist/remote/index.js";

function fixture(options = {}) {
  let now = 1_000;
  let seed = 0;
  const store = new RemoteReconnectGrantStore({
    serverId: "server-a",
    sessionOrigin: "https://session.example.test",
    now: () => now,
    randomBytes: (size) => Uint8Array.from({ length: size }, () => {
      seed = (seed + 17) % 251;
      return seed;
    }),
    ...options,
  });
  return {
    store,
    advance(value) {
      now = value;
    },
  };
}

test("reconnect grants keep opaque secret material out of records and prove one challenge", () => {
  const { store } = fixture();
  const issued = store.issue({ deviceId: "device-a", lifetime: "until-revoked" });
  assert.match(issued.grant, /^[A-Za-z0-9_-]{43}$/);
  assert.match(issued.handle, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(issued.grant, issued.handle);
  assert.equal(store.summary("device-a").status, "valid");

  const challenge = store.createChallenge({
    handle: issued.handle,
    origin: issued.sessionOrigin,
    clientNonce: "client-nonce-a",
  });
  assert.equal(challenge.challenge.serverId, "server-a");
  assert.equal(challenge.challenge.sessionOrigin, issued.sessionOrigin);
  assert.equal(JSON.stringify(store.list()).includes(issued.grant), false);
  const proof = createRemoteReconnectProof(issued.grant, challenge.signingInput);
  const verified = store.verifyProof({
    attemptId: challenge.challenge.attemptId,
    handle: issued.handle,
    origin: issued.sessionOrigin,
    clientNonce: "client-nonce-a",
    proof,
    verifyDeviceProof: (deviceId, signingInput) =>
      deviceId === "device-a" && signingInput === challenge.signingInput,
  });
  assert.equal(verified.deviceId, "device-a");
  assert.equal(verified.lastUsedAt, 1_000);
  assert.throws(
    () => store.verifyProof({
      attemptId: challenge.challenge.attemptId,
      handle: issued.handle,
      origin: issued.sessionOrigin,
      clientNonce: "client-nonce-a",
      proof,
    }),
    /unavailable/,
  );
});

test("persisted reconnect records restore proof verification without restoring a grant secret", () => {
  const first = fixture();
  const issued = first.store.issue({ deviceId: "durable-device", lifetime: "until-revoked" });
  const records = first.store.list();
  assert.equal(JSON.stringify(records).includes(issued.grant), false);

  const restored = fixture({ initialRecords: records }).store;
  const pending = restored.createChallenge({
    handle: issued.handle,
    origin: issued.sessionOrigin,
    clientNonce: "durable-client-nonce",
  });
  assert.equal(restored.verifyProof({
    attemptId: pending.challenge.attemptId,
    handle: issued.handle,
    origin: issued.sessionOrigin,
    clientNonce: "durable-client-nonce",
    proof: createRemoteReconnectProof(issued.grant, pending.signingInput),
  }).deviceId, "durable-device");
  assert.throws(
    () => fixture({ initialRecords: [{ ...records[0], serverId: "other-server" }] }),
    /persisted reconnect grant record is invalid/,
  );
});

test("reconnect challenges are exact-origin, retryable after forged proof, and expire", () => {
  const fixtureValue = fixture({ challengeTtlMs: 20 });
  const issued = fixtureValue.store.issue({ deviceId: "device-b" });
  assert.throws(
    () => fixtureValue.store.createChallenge({
      handle: issued.handle,
      origin: "https://other.example.test",
      clientNonce: "wrong-origin",
    }),
    /origin/,
  );
  const challenge = fixtureValue.store.createChallenge({
    handle: issued.handle,
    origin: issued.sessionOrigin,
    clientNonce: "client-nonce-b",
  });
  assert.throws(
    () => fixtureValue.store.verifyProof({
      attemptId: challenge.challenge.attemptId,
      handle: issued.handle,
      origin: issued.sessionOrigin,
      clientNonce: "client-nonce-b",
      proof: createRemoteReconnectProof(
        fixtureValue.store.issue({ deviceId: "other-device", lifetime: "until-revoked" }).grant,
        challenge.signingInput,
      ),
    }),
    /invalid/,
  );
  const validProof = createRemoteReconnectProof(issued.grant, challenge.signingInput);
  assert.equal(
    fixtureValue.store.verifyProof({
      attemptId: challenge.challenge.attemptId,
      handle: issued.handle,
      origin: issued.sessionOrigin,
      clientNonce: "client-nonce-b",
      proof: validProof,
    }).deviceId,
    "device-b",
  );

  const expiredChallenge = fixtureValue.store.createChallenge({
    handle: issued.handle,
    origin: issued.sessionOrigin,
    clientNonce: "client-nonce-expired",
  });
  fixtureValue.advance(1_021);
  assert.throws(
    () => fixtureValue.store.verifyProof({
      attemptId: expiredChallenge.challenge.attemptId,
      handle: issued.handle,
      origin: issued.sessionOrigin,
      clientNonce: "client-nonce-expired",
      proof: "not-a-proof",
    }),
    /unavailable/,
  );
});

test("a throwing device-proof verifier consumes only its reconnect challenge", () => {
  const { store } = fixture({ maxChallenges: 1 });
  const issued = store.issue({ deviceId: "device-proof-verifier" });
  const first = store.createChallenge({
    handle: issued.handle,
    origin: issued.sessionOrigin,
    clientNonce: "device-proof-first",
  });
  const proof = createRemoteReconnectProof(issued.grant, first.signingInput);

  assert.throws(
    () => store.verifyProof({
      attemptId: first.challenge.attemptId,
      handle: issued.handle,
      origin: issued.sessionOrigin,
      clientNonce: "device-proof-first",
      proof,
      verifyDeviceProof: () => { throw new Error("verifier unavailable"); },
    }),
    /verification failed/,
  );
  assert.throws(
    () => store.verifyProof({
      attemptId: first.challenge.attemptId,
      handle: issued.handle,
      origin: issued.sessionOrigin,
      clientNonce: "device-proof-first",
      proof,
    }),
    /unavailable/,
  );
  assert.doesNotThrow(() => store.createChallenge({
    handle: issued.handle,
    origin: issued.sessionOrigin,
    clientNonce: "device-proof-retry",
  }));
});

test("rotation and revocation fence reconnect grants without affecting another device", () => {
  const { store } = fixture();
  const first = store.issue({ deviceId: "device-c", lifetime: "7d" });
  const other = store.issue({ deviceId: "device-d", lifetime: "until-revoked" });
  const rotated = store.rotate({ handle: first.handle, origin: first.sessionOrigin });
  assert.notEqual(rotated.handle, first.handle);
  assert.equal(store.list().find((record) => record.handle === first.handle)?.revokedAt, 1_000);
  assert.throws(
    () => store.createChallenge({ handle: first.handle, origin: first.sessionOrigin, clientNonce: "old-client" }),
    /no longer valid/,
  );
  assert.equal(store.revokeDevice("device-c"), 1);
  assert.equal(store.summary("device-c").status, "revoked");
  assert.equal(store.summary("device-c").handle, null);
  assert.equal(store.summary("device-d").status, "valid");
  assert.doesNotThrow(() => store.createChallenge({
    handle: other.handle,
    origin: other.sessionOrigin,
    clientNonce: "other-client",
  }));
});

test("revocation and rotation release obsolete pending reconnect challenge capacity immediately", () => {
  const { store } = fixture({ maxChallenges: 1 });
  const first = store.issue({ deviceId: "device-cleanup" });
  store.createChallenge({
    handle: first.handle,
    origin: first.sessionOrigin,
    clientNonce: "cleanup-first-client",
  });
  assert.equal(store.revokeDevice("device-cleanup"), 1);

  const replacement = store.issue({ deviceId: "device-cleanup" });
  assert.doesNotThrow(() => store.createChallenge({
    handle: replacement.handle,
    origin: replacement.sessionOrigin,
    clientNonce: "cleanup-revoked-client",
  }));

  const rotated = store.rotate({
    handle: replacement.handle,
    origin: replacement.sessionOrigin,
  });
  assert.doesNotThrow(() => store.createChallenge({
    handle: rotated.handle,
    origin: rotated.sessionOrigin,
    clientNonce: "cleanup-rotated-client",
  }));
});

test("expired grant is reported offline and cannot create a reconnect challenge", () => {
  const fixtureValue = fixture();
  const issued = fixtureValue.store.issue({ deviceId: "device-e", lifetime: "1h" });
  fixtureValue.advance(1_000 + 60 * 60 * 1000);
  assert.equal(fixtureValue.store.summary("device-e").status, "expired");
  assert.equal(fixtureValue.store.summary("device-e").handle, null);
  assert.throws(
    () => fixtureValue.store.createChallenge({
      handle: issued.handle,
      origin: issued.sessionOrigin,
      clientNonce: "late-client",
    }),
    /no longer valid/,
  );
});
