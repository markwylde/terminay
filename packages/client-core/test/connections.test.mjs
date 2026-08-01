import test from "node:test";
import assert from "node:assert/strict";
import { ConnectionProfileStore } from "../dist/connections.js";

test("connection profiles keep Local immutable and separate status from activity", () => {
  let now = 100;
  const store = new ConnectionProfileStore({ now: () => now });
  const remote = store.remember({ id: "prod", serverId: "srv-prod", label: "Production", origin: "https://prod.example.test", status: "offline" });
  assert.equal(store.currentProfile.label, "Local");
  assert.deepEqual(store.availableActions(remote.id), ["open", "focus", "switch", "manage", "retry", "forget"]);
  now = 200;
  store.select(remote.id);
  store.markStatus(remote.id, "connected");
  assert.equal(store.currentProfile.id, "prod");
  assert.equal(store.currentProfile.lastConnectedAt, 200);
  assert.throws(() => store.forget("local", true), /Local/);
});

test("profile import rejects credentials, fragments, and token-like fields", () => {
  const store = new ConnectionProfileStore();
  assert.throws(() => store.import({ id: "bad", serverId: "srv", label: "Bad", origin: "https://example.test/path#pairing-secret" }), /origin/);
  assert.throws(() => store.import({ id: "bad", serverId: "srv", label: "Bad", origin: "https://user:pass@example.test" }), /origin/);
  assert.throws(() => store.import({ id: "bad", serverId: "srv", label: "Bad", origin: "https://example.test", reconnectGrant: "secret" }), /origin|credential|invalid/);
});

test("profile import fails closed on legacy authority-shaped metadata", () => {
  const store = new ConnectionProfileStore({ local: false });
  const profile = {
    id: "remote-a",
    serverId: "server-a",
    label: "Remote A",
    origin: "https://remote-a.example.test",
  };
  assert.deepEqual(store.import(profile), {
    ...profile,
    status: "offline",
    createdAt: store.get("remote-a").createdAt,
  });
  for (const field of ["workspaceSnapshot", "terminalSessions", "trustedDevice", "serverCapabilities", "layout"])
    assert.throws(() => store.import({ ...profile, id: `bad-${field}`, [field]: {} }), /unsupported compatibility data/);
});

test("forget requires explicit confirmation and never revokes server access implicitly", () => {
  const store = new ConnectionProfileStore();
  store.remember({ id: "home", serverId: "srv-home", label: "Home", origin: "https://home.example.test" });
  assert.throws(() => store.forget("home"), /confirmation/);
  assert.equal(store.forget("home", true), true);
  assert.equal(store.get("home"), undefined);
});

test("revoke is an explicit remote-profile state transition and Local stays immutable", () => {
  const store = new ConnectionProfileStore();
  store.remember({ id: "revocable", serverId: "srv", label: "Remote", origin: "https://remote.example" });
  assert.throws(() => store.revoke("revocable"), /confirmation/);
  assert.equal(store.revoke("revocable", true).status, "revoked");
  assert.throws(() => store.revoke("local", true), /Local/);
});

test("rename, archive, forget, and revoke remain distinct host-local management actions", () => {
  const store = new ConnectionProfileStore();
  const remote = store.remember({ id: "managed", serverId: "srv-managed", label: "Original", origin: "https://managed.example" });
  assert.equal(store.rename(remote.id, "Renamed").label, "Renamed");
  assert.throws(() => store.rename("local", "Not Local"), /immutable/);
  assert.throws(() => store.rename(remote.id, "bad\nlabel"), /label/);

  store.select(remote.id);
  assert.equal(store.archive(remote.id).archived, true);
  assert.equal(store.currentProfile?.id, "local");
  assert.throws(() => store.select(remote.id), /archived/);
  assert.equal(store.unarchive(remote.id).archived, false);
  assert.equal(store.select(remote.id).id, remote.id);

  assert.throws(() => store.revoke(remote.id), /confirmation/);
  assert.equal(store.revoke(remote.id, true).status, "revoked");
  assert.equal(store.get(remote.id)?.archived, false);
  assert.throws(() => store.forget(remote.id), /confirmation/);
  assert.equal(store.forget(remote.id, true), true);
  assert.equal(store.get(remote.id), undefined);
});

test("browser profile stores do not fabricate a Local server", () => {
  const store = new ConnectionProfileStore({ local: false });
  assert.equal(store.currentProfile, undefined);
  assert.deepEqual(store.snapshot(), { revision: 0, profiles: [] });
  const profile = store.remember({ id: "browser-prod", serverId: "srv-prod", label: "Production", origin: "https://prod.example.test" });
  assert.equal(store.select(profile.id).id, "browser-prod");
  assert.equal(store.currentProfile?.label, "Production");
  assert.equal(store.forget(profile.id, true), true);
  assert.equal(store.currentProfile, undefined);
});
