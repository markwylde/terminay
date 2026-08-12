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
    confirm: async () => snapshot = { ...snapshot, revision: snapshot.revision + 1 },
    enable: async () => snapshot, disable: async () => snapshot, remove: async () => snapshot, rollback: async () => snapshot,
  };
}

test("fixed extension operations expose bounded catalogue and preview DTOs", async () => {
  const handlers = createExtensionOperationHandlers({ installer: installer(), authorityLabel: "Remote Terminay" });
  const list = await handlers.queries["extensions.list"](query("extensions.list", {}));
  assert.equal(list.authorityLabel, "Remote Terminay"); assert.equal(list.catalogue.length, 2); assert.equal(list.catalogue[0].official, true);
  const preview = await handlers.queries["extensions.preview-install"](query("extensions.preview-install", { spec: "fixture-extension" }, ["extensions:manage"]));
  assert.equal(preview.exactVersion, "1.2.3"); assert.equal(preview.extensionId, "dev.example.fixture"); assert.deepEqual(preview.permissions, ["network"]); assert.equal(preview.trustedCodeWarning, "trusted code");
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
