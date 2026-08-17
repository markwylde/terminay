import test from "node:test";
import assert from "node:assert/strict";
import { RemotePairingStore } from "../dist/remote/index.js";

function fixture(overrides = {}) {
  let now = 100;
  let seed = 0;
  const store = new RemotePairingStore({
    serverId: "srv",
    sessionOrigin: "https://session.example.test",
    now: () => now,
    randomBytes: (size) => Uint8Array.from({ length: size }, () => ++seed),
    ...overrides,
  });
  return { store, advance: (value) => { now = value; } };
}

test("pairing rooms expose the one-time secret only at creation and consume once", () => {
  const { store } = fixture();
  const room = store.create(300);
  const metadata = store.metadata(room.roomId);
  assert.equal("secret" in metadata, false);
  assert.equal(JSON.stringify(store).includes(room.secret), false);
  assert.equal(metadata.state, "active");
  const admission = store.consume({ roomId: room.roomId, serverId: "srv", sessionOrigin: "https://session.example.test", secret: room.secret });
  assert.equal(admission.roomId, room.roomId);
  assert.equal(store.metadata(room.roomId).state, "consumed");
  assert.throws(() => store.consume({ roomId: room.roomId, serverId: "srv", sessionOrigin: "https://session.example.test", secret: room.secret }), /unavailable/);
});

test("pairing attempts are origin-bound and wrong secrets lock after bounded failures", () => {
  const { store } = fixture({ maxFailedAttempts: 2 });
  const room = store.create(300);
  assert.throws(() => store.consume({ ...room, secret: "wrong" }), /unavailable|invalid/);
  assert.throws(() => store.consume({ ...room, secret: "wrong-again" }), /invalid/);
  assert.equal(store.metadata(room.roomId).state, "locked");
  const second = store.create(300);
  assert.throws(() => store.consume({ ...second, sessionOrigin: "https://other.example.test" }), /unavailable/);
});

test("rotation invalidates active rooms without changing server or session origin", () => {
  const { store } = fixture();
  const oldRoom = store.create(300);
  assert.throws(() => store.rotate(100), /expiry/);
  assert.equal(store.metadata(oldRoom.roomId).state, "active");
  const nextRoom = store.rotate(300);
  assert.equal(store.metadata(oldRoom.roomId), undefined);
  assert.equal(nextRoom.serverId, "srv");
  assert.equal(nextRoom.sessionOrigin, "https://session.example.test");
  assert.throws(() => store.consume({ ...oldRoom }), /unavailable/);
  assert.equal(store.consume({ ...nextRoom }).roomId, nextRoom.roomId);
});

test("expired rooms become unavailable and terminal room state is reclaimed", () => {
  const { store, advance } = fixture({ maxRooms: 1 });
  const room = store.create(300);
  advance(300);
  assert.equal(store.metadata(room.roomId).state, "expired");
  assert.throws(() => store.consume({ ...room }), /unavailable/);
  const replacement = store.create(500);
  assert.notEqual(replacement.roomId, room.roomId);
});

test("an invalid pairing clock expires active one-time rooms rather than extending their lifetime", () => {
  let now = 100;
  let seed = 0;
  const store = new RemotePairingStore({
    serverId: "srv",
    sessionOrigin: "https://session.example.test",
    now: () => now,
    randomBytes: (size) => Uint8Array.from({ length: size }, () => ++seed),
  });
  const room = store.create(300);

  now = Number.NaN;
  assert.equal(store.metadata(room.roomId)?.state, "expired");
  assert.throws(() => store.consume({ ...room }), /unavailable/);
  assert.throws(() => store.create(), /clock is invalid/);

  now = 200;
  assert.throws(() => store.consume({ ...room }), /unavailable/);
  const replacement = store.create(400);
  assert.notEqual(replacement.roomId, room.roomId);
});

test("pairing entropy collisions never overwrite an active room and fail closed when persistent", () => {
  let calls = 0;
  const firstThenUnique = fixture({
    randomBytes: (size) => Uint8Array.from({ length: size }, () => {
      calls += 1;
      return calls <= 2 ? 7 : calls;
    }),
  }).store;
  const first = firstThenUnique.create(300);
  const second = firstThenUnique.create(300);
  assert.notEqual(second.roomId, first.roomId);
  assert.equal(firstThenUnique.consume({ ...first }).roomId, first.roomId);

  const persistentCollision = fixture({
    randomBytes: (size) => Uint8Array.from({ length: size }, () => 9),
  }).store;
  const active = persistentCollision.create(300);
  assert.throws(() => persistentCollision.create(300), /entropy collision/);
  assert.equal(persistentCollision.consume({ ...active }).roomId, active.roomId);
});

test('identified pairing rooms keep the caller-supplied room id and secret', () => {
  const { store } = fixture();
  const room = store.createIdentified({
    expiresAt: 300,
    roomId: 'derivedroomid1234567890abcdefghijk',
    secret: 'derivedpairingtokenvalue12',
  });
  assert.equal(room.roomId, 'derivedroomid1234567890abcdefghijk');
  assert.equal(
    store.consume({
      roomId: room.roomId,
      secret: 'derivedpairingtokenvalue12',
      serverId: 'srv',
      sessionOrigin: 'https://session.example.test',
    }).roomId,
    room.roomId,
  );
});
