import test from "node:test";
import assert from "node:assert/strict";
import {
  createRecoveryClientFallback,
  inspectCompatibilityAdapterCleanup,
  inspectLegacyMigration,
} from "../dist/migration/index.js";

test("recovery fallback points directly at the server bundle without host credentials", () => {
  const fallback = createRecoveryClientFallback({ origin: "https://session-prod.terminay.com", bundleId: "bundle_12345678" });
  assert.deepEqual(fallback, {
    mode: "direct-server-bundle",
    origin: "https://session-prod.terminay.com",
    entryPath: "/",
    bundleId: "bundle_12345678",
    requiresHostShell: false,
    authority: "server",
    reason: "host-shell-unavailable",
  });
  assert.equal(JSON.stringify(fallback).includes("token"), false);
  assert.throws(() => createRecoveryClientFallback({ origin: "https://session-prod.terminay.com/workspace" }), /credential-free origin/);
  assert.throws(() => createRecoveryClientFallback({ origin: "https://session-prod.terminay.com?bootstrap_credential=secret" }), /credential-free origin/);
  assert.throws(() => createRecoveryClientFallback({ origin: "https://user:password@session-prod.terminay.com" }), /credential-free origin/);
  assert.throws(() => createRecoveryClientFallback({ origin: "https://session-prod.terminay.com", bundleId: "unsafe bundle" }), /bundle id is invalid/);
});

test("legacy preload and terminal-only adapters report cleanup blockers without copying payloads", () => {
  const report = inspectCompatibilityAdapterCleanup({
    legacyAdapters: {
      rendererPreload: { channels: ["workspace", "terminal"], payload: "must-not-copy" },
      terminalOnlyRemote: true,
      recordingPreload: false,
      fileViewerPreload: { present: false, path: "/private/legacy" },
    },
  });
  assert.deepEqual(report, {
    adapters: [
      { name: "rendererPreload", present: true, authority: "compatibility-adapter", cleanup: "retain-until-parity", reason: "server-client-parity-not-proven" },
      { name: "terminalOnlyRemote", present: true, authority: "compatibility-adapter", cleanup: "retain-until-parity", reason: "server-client-parity-not-proven" },
      { name: "recordingPreload", present: false, authority: "server", cleanup: "not-present", reason: "not-present" },
      { name: "fileViewerPreload", present: false, authority: "server", cleanup: "not-present", reason: "not-present" },
    ],
    pendingCount: 2,
    serverAuthorityReady: false,
  });
  assert.equal(JSON.stringify(report).includes("must-not-copy"), false);
  assert.equal(JSON.stringify(report).includes("/private/legacy"), false);
});

test("migration preflight explicitly reports renderer-only layout as unrecoverable", async () => {
  const inventory = await inspectLegacyMigration({ rendererLayout: { panels: [{ type: "terminal", sessionId: "renderer-only" }] } }, { pathProbe: () => "missing" });
  assert.deepEqual(inventory.rendererLayout, {
    recoverable: false,
    reason: "renderer-only-layout-not-persisted",
  });
});
