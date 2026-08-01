import assert from "node:assert/strict";
import test from "node:test";
import {
  ConnectionProfileStore,
  WindowViewRegistry,
  createDesktopServerUiConnectionBinding,
  createRemoteProfile,
} from "../dist/main/index.js";

test("server UI actions persist profiles and preserve exact multi-window selection", async () => {
  const persistedProfiles = [];
  const persistedWindows = [];
  const profiles = new ConnectionProfileStore({
    initial: [createRemoteProfile({
      id: "remote:a",
      serverId: "server:a",
      label: "Remote A",
      origin: "https://a.example",
      now: "2026-01-01T00:00:00.000Z",
    })],
    storage: { load: () => [], save: (value) => persistedProfiles.push(value) },
  });
  const windows = new WindowViewRegistry({
    storage: { load: () => [], save: (value) => persistedWindows.push(value) },
  });
  const host = {
    profiles,
    windows,
    host: { capabilities: { has: (name) => name === "connectionProfiles" || name === "serverExposure" } },
    currentConnectionHeader: { profileId: "remote:a" },
    openProfileWindow: async (profileId) => ({
      selection: windows.select(profileId, undefined, { createWindowId: () => "window:a" }),
    }),
    disconnect: async () => undefined,
  };
  const presented = [];
  const privileged = [];
  const binding = createDesktopServerUiConnectionBinding(host, {
    present: (selection) => presented.push(selection),
    expose: (profile) => privileged.push(`expose:${profile.id}`),
    revoke: (profile) => privileged.push(`revoke:${profile.id}`),
    pair: async (pairingUrl) => {
      privileged.push(`pair:${new URL(pairingUrl).host}`);
      return createRemoteProfile({
        id: "remote:paired",
        serverId: "server:paired",
        label: "Paired",
        origin: "https://paired.example",
        now: "2026-01-01T00:00:00.000Z",
      });
    },
  });

  await binding.onHostAction({ type: "connection.select", profileId: "remote:a" });
  await binding.onHostAction({ type: "connection.select", profileId: "remote:a" });
  assert.equal(presented[0].action, "open");
  assert.equal(presented[1].action, "focus");
  assert.deepEqual(presented[1].binding, presented[0].binding);

  await binding.onHostAction({
    type: "connection.remember",
    profile: { id: "remote:b", serverId: "server:b", label: "Remote B", origin: "https://b.example", status: "offline" },
  });
  await binding.onHostAction({ type: "connection.rename", profileId: "remote:b", label: "Renamed B" });
  await binding.onHostAction({ type: "connection.expose", profileId: "remote:a" });
  await binding.onHostAction({ type: "connection.revoke", profileId: "remote:b" });
  assert.equal(profiles.get("remote:b").status, "revoked");
  await binding.onHostAction({ type: "connection.forget", profileId: "remote:b" });
  assert.equal(profiles.get("remote:b"), undefined);
  await binding.onHostAction({
    type: "connection.pair",
    pairingUrl: "https://pair.example/session#one-time-secret",
  });

  await profiles.flush();
  await windows.flush();
  assert.deepEqual(privileged, [
    "expose:remote:a",
    "revoke:remote:b",
    "pair:pair.example",
  ]);
  assert.equal(profiles.get("remote:paired").origin, "https://paired.example");
  assert.ok(persistedProfiles.length >= 4);
  assert.doesNotMatch(JSON.stringify(persistedProfiles), /one-time-secret|pair\.example\/session/u);
  assert.deepEqual(persistedWindows.at(-1), [{
    windowId: "window:a",
    connectionId: "remote:a",
  }]);
});
