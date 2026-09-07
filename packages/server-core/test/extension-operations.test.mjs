import assert from "node:assert/strict";
import test from "node:test";
import { createExtensionOperationHandlers } from "../dist/extensions/index.js";

const context = (permissions, expectedRevision) => ({ connectionId: "conn", clientId: "client", authScope: "write", permissions, claims: {}, signal: new AbortController().signal, expectedRevision });
const query = (operation, payload, permissions = ["extensions:read"]) => ({ envelope: { type: "query", queryId: "query", operation, payload }, body: new Uint8Array(), context: context(permissions) });
const command = (operation, payload, revision = 0, permissions = ["extensions:manage"]) => ({ envelope: { type: "command", commandId: "command", correlationId: "correlation", operation, payload: { idempotencyKey: `${operation}-key`, ...payload }, expectedRevision: revision }, body: new Uint8Array(), context: context(permissions, revision) });

function installer() {
  let snapshot = { schemaVersion: 1, revision: 0, extensions: {} };
  const preview = { previewDigest: "digest", packageName: "fixture-extension", version: "1.2.3", integrity: "sha512-test", expiresAt: Date.now() + 1000, official: false, trustedCodeWarning: "trusted code", declaredPermissions: ["network"], declaredProviderIds: ["dev.example.fixture/main"], manifestMetadata: { id: "dev.example.fixture" }, maintainers: [], provenance: "unavailable" };
  return {
    snapshot: async () => snapshot,
    preview: async () => preview,
    previewArchive: async (filename, bytes) => ({ ...preview, source: "uploaded", uploadedFilename: filename, integrity: `sha512-${Buffer.from(bytes).toString("base64")}` }),
    confirm: async () => snapshot = { ...snapshot, revision: snapshot.revision + 1 },
    enable: async () => snapshot, disable: async () => snapshot, remove: async () => snapshot, rollback: async () => snapshot,
  };
}

test("fixed extension operations expose bounded catalogue and preview DTOs", async () => {
  const handlers = createExtensionOperationHandlers({ installer: installer(), authorityLabel: "Remote Terminay" });
  const list = await handlers.queries["extensions.list"](query("extensions.list", {}));
  assert.equal(list.authorityLabel, "Remote Terminay"); assert.equal(list.catalogue.length, 7); assert.equal(list.catalogue[0].official, true);
  const preview = await handlers.queries["extensions.preview-install"](query("extensions.preview-install", { spec: "fixture-extension" }, ["extensions:manage"]));
  assert.equal(preview.exactVersion, "1.2.3"); assert.equal(preview.extensionId, "dev.example.fixture"); assert.deepEqual(preview.permissions, ["network"]); assert.equal(preview.trustedCodeWarning, "trusted code");
});

test("package-file preview is binary, permission-bound, and visibly unverified", async () => {
  const handlers = createExtensionOperationHandlers({ installer: installer(), authorityLabel: "Remote Terminay" });
  await assert.rejects(handlers.commands["extensions.preview-package-file"](command("extensions.preview-package-file", { filename: "fixture.tgz" }, 0, [])), (error) => error.code === "forbidden");
  const request = command("extensions.preview-package-file", { filename: "fixture.tgz" }); request.body = Uint8Array.of(1, 2, 3);
  const result = await handlers.commands["extensions.preview-package-file"](request);
  assert.equal(result.result.source, "uploaded"); assert.equal(result.result.filename, "fixture.tgz"); assert.equal(result.result.official, false);
});

test("extension operations enforce transport permissions and optimistic revisions", async () => {
  const events = []; const audits = []; const fixture = installer();
  const handlers = createExtensionOperationHandlers({ installer: fixture, authorityLabel: "This server", onChanged: (event) => events.push(event), audit: (event) => audits.push(event) });
  await assert.rejects(handlers.queries["extensions.list"](query("extensions.list", {}, [])), (error) => error.code === "forbidden");
  await assert.rejects(handlers.commands["extensions.install"](command("extensions.install", { previewDigest: "digest", confirmation: true, expectedRevision: 2 }, 2)), (error) => error.code === "conflict");
  const result = await handlers.commands["extensions.install"](command("extensions.install", { previewDigest: "digest", confirmation: true, expectedRevision: 0 }, 0));
  assert.equal(result.revision, 1); assert.equal(result.result.authorityLabel, "This server");
  const replay = await handlers.commands["extensions.install"](command("extensions.install", { previewDigest: "digest", confirmation: true, expectedRevision: 0 }, 0));
  assert.deepEqual(replay, result); assert.deepEqual(events, [{ revision: 1 }]); assert.equal(audits.length, 1); assert.equal(audits[0].clientId, "client");
});

test("Settings receives one merged built-in override entry and reflects disablement and reversion", async () => {
  const extensionId = "com.terminay.agent.codex";
  const manifest = { displayName: "Codex", id: extensionId };
  const bundled = { slotId: "built-in-v1", version: "1.0.0", receipt: { source: "built-in", manifest } };
  const override = { slotId: "npm-v2", version: "2.0.0", receipt: { source: "npmjs", manifest } };
  let snapshot = { schemaVersion: 1, revision: 3, extensions: { [extensionId]: { extensionId, packageName: "terminay-agent-codex", enabled: true, state: "installed", activeSlotId: override.slotId, pendingSlotId: bundled.slotId, slots: { [bundled.slotId]: bundled, [override.slotId]: override } } } };
  const fixture = {
    snapshot: async () => snapshot,
    disable: async () => (snapshot = { ...snapshot, revision: 4, extensions: { [extensionId]: { ...snapshot.extensions[extensionId], enabled: false, state: "disabled" } } }),
    remove: async () => (snapshot = { ...snapshot, revision: 5, extensions: { [extensionId]: { ...snapshot.extensions[extensionId], activeSlotId: bundled.slotId, pendingSlotId: undefined } } }),
  };
  const handlers = createExtensionOperationHandlers({ installer: fixture, authorityLabel: "This server" });
  const listed = await handlers.queries["extensions.list"](query("extensions.list", {}));
  assert.equal(listed.extensions.length, 1); assert.equal(listed.catalogue.some((item) => item.extensionId === extensionId), false);
  const entry = listed.extensions[0];
  assert.deepEqual({ builtIn: entry.builtIn, bundledVersion: entry.bundledVersion, override: entry.override, origin: entry.origin, activeVersion: entry.activeVersion, pendingVersion: entry.pendingVersion, enabled: entry.enabled, compatible: entry.compatible, runtimeState: entry.runtimeState }, { builtIn: true, bundledVersion: "1.0.0", override: true, origin: "npmjs", activeVersion: "2.0.0", pendingVersion: "1.0.0", enabled: true, compatible: true, runtimeState: "activation-required" });
  const fetched = await handlers.queries["extensions.get"](query("extensions.get", { extensionId }));
  assert.equal(fetched.extensionId, extensionId);
  await handlers.commands["extensions.disable"](command("extensions.disable", { extensionId, expectedRevision: 3 }, 3));
  let after = await handlers.queries["extensions.list"](query("extensions.list", {}));
  assert.equal(after.extensions[0].enabled, false); assert.equal(after.extensions[0].runtimeState, "stopped");
  await handlers.commands["extensions.remove"](command("extensions.remove", { extensionId, expectedRevision: 4 }, 4));
  after = await handlers.queries["extensions.list"](query("extensions.list", {}));
  assert.equal(after.extensions[0].activeVersion, "1.0.0"); assert.equal(after.extensions[0].origin, "built-in"); assert.equal(after.extensions[0].override, false);
});

test("enabled records without a running host are pending, and a failed hot activation is explicit", async () => {
  const extensionId = "dev.example.reconciled";
  const manifest = { displayName: "Reconciled", id: extensionId };
  const slot = { slotId: "slot-v1", version: "1.0.0", receipt: { source: "built-in", manifest } };
  let snapshot = { schemaVersion: 1, revision: 2, extensions: { [extensionId]: { extensionId, packageName: "terminay-reconciled", enabled: true, state: "installed", activeSlotId: slot.slotId, slots: { [slot.slotId]: slot } } } };
  const fixture = {
    snapshot: async () => snapshot,
    enable: async () => snapshot,
    setFailureState: async (id, state, failureClass) => (snapshot = { ...snapshot, revision: snapshot.revision + 1, extensions: { ...snapshot.extensions, [id]: { ...snapshot.extensions[id], state, failureClass } } }),
  };
  const handlers = createExtensionOperationHandlers({ installer: fixture, authorityLabel: "This server", hosts: { statuses: () => [] }, activate: async () => { throw new Error("activation refused"); } });
  const pending = await handlers.queries["extensions.list"](query("extensions.list", {}));
  assert.equal(pending.extensions[0].runtimeState, "activation-required");
  const result = await handlers.commands["extensions.enable"](command("extensions.enable", { extensionId, expectedRevision: 2 }, 2));
  assert.equal(result.result.extensions[0].runtimeState, "failed");
  assert.equal(result.result.extensions[0].failureMessage, "activation refused");
});
