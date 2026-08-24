import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileStore, HostTrustManager, SshProviderError } from "../dist/index.js";

const input = { id: "prod", displayName: "Production", hostname: "prod.example.test", port: 22, username: "mark", auth: { mode: "private-key", privateKeySecretRef: "ssh-key" }, defaultRoot: "~", hostVerification: "strict", timeouts: { connectMs: 2000, handshakeMs: 2000, keepaliveMs: 2000 } };

async function fixture() { const root = await mkdtemp(join(tmpdir(), "terminay-ssh-")); const store = await new ProfileStore(join(root, "config"), join(root, "data")).load(); return { root, store, trust: new HostTrustManager(store, { ttlMs: 10000 }) }; }

test("profiles are revisioned, redacted, persisted, and removal is reference-safe", async () => {
  const { root, store } = await fixture(); const created = await store.save(input, "device-a");
  assert.equal(created.revision, 1); assert.equal(created.authMode, "private-key"); assert.equal(JSON.stringify(created).includes("ssh-key"), false);
  await assert.rejects(() => store.save({ ...input, displayName: "changed", expectedRevision: 0 }), (e) => e.code === "revision-conflict");
  const updated = await store.save({ ...input, displayName: "changed", expectedRevision: 1 }); assert.equal(updated.revision, 2);
  await store.setReferences("prod", ["project-1"]); await assert.rejects(() => store.remove("prod", 2), (e) => e.code === "profile-referenced");
  const persisted = JSON.parse(await readFile(join(root, "config", "ssh-profiles.json"), "utf8")); assert.equal(persisted.profiles.prod.auth.privateKeySecretRef, "ssh-key");
  const audit = await readFile(join(root, "data", "ssh-audit.jsonl"), "utf8"); assert.equal(audit.includes("device-a"), true); assert.equal(audit.includes("ssh-key"), false);
});

test("first use, exact approval, mismatch, replacement, and replay fail closed", async () => {
  const { store, trust } = await fixture(); await store.save(input); const profile = store.get("prod", 1);
  let first; try { trust.verify(profile, Buffer.from("first-key"), "ssh-ed25519"); } catch (e) { first = e; }
  assert.equal(first.code, "host-key-approval-required"); assert.match(first.details.fingerprint, /^SHA256:/);
  await trust.approve({ profileId: "prod", expectedRevision: 1, challengeId: first.details.challengeId, action: "approve" }, "device-a");
  assert.equal(trust.verify(profile, Buffer.from("first-key"), "ssh-ed25519").accepted, true);
  await assert.rejects(() => trust.approve({ profileId: "prod", expectedRevision: 1, challengeId: first.details.challengeId, action: "approve" }, "device-a"), (e) => e.code === "trust-challenge-stale");
  let changed; try { trust.verify(profile, Buffer.from("different-key"), "ssh-ed25519"); } catch (e) { changed = e; }
  assert.equal(changed.code, "host-key-mismatch"); assert.ok(changed.details.expectedFingerprint);
  await assert.rejects(() => trust.approve({ profileId: "prod", expectedRevision: 1, challengeId: changed.details.challengeId, action: "approve" }, "device-a"), (e) => e.code === "trust-challenge-stale");
  await trust.approve({ profileId: "prod", expectedRevision: 1, challengeId: changed.details.challengeId, action: "replace" }, "device-a");
  assert.equal(trust.verify(profile, Buffer.from("different-key"), "ssh-ed25519").accepted, true);
});

test("unsafe bypass is profile-local, separately confirmed, revisioned and reversible", async () => {
  const { store, trust } = await fixture(); await store.save(input);
  await assert.rejects(() => trust.confirmUnsafe({ profileId: "prod", expectedRevision: 1, confirmation: "yes" }, "admin"), (e) => e.code === "invalid-input");
  const unsafe = await trust.confirmUnsafe({ profileId: "prod", expectedRevision: 1, confirmation: "DISABLE HOST KEY VERIFICATION" }, "admin");
  assert.equal(unsafe.hostVerification, "unsafe"); assert.equal(unsafe.revision, 2);
  assert.deepEqual(trust.verify(store.get("prod", 2), Buffer.from("anything")), { accepted: true, unsafe: true });
  const strict = await trust.restoreStrict({ profileId: "prod", expectedRevision: 2 }, "admin"); assert.equal(strict.hostVerification, "strict"); assert.equal(strict.revision, 3);
});

test("host or port changes clear trust while unrelated profile revisions retain it", async () => {
  const { store, trust } = await fixture(); await store.save(input); const profile = store.get("prod", 1);
  let challenge; try { trust.verify(profile, Buffer.from("key")); } catch (e) { challenge = e; }
  await trust.approve({ profileId: "prod", expectedRevision: 1, challengeId: challenge.details.challengeId, action: "approve" }, "admin");
  await store.save({ ...input, expectedRevision: 1, displayName: "New name" }); assert.ok(store.trust("prod"));
  await store.save({ ...input, expectedRevision: 2, displayName: "New name", port: 2222 }); assert.equal(store.trust("prod"), undefined);
});

test("stable logical host identity retains exact trust across dial-address changes", async () => {
  const { store, trust } = await fixture();
  await store.save({ ...input, logicalHostIdentity: "puzed:platform-a:vm-42" }); const first = store.get("prod", 1);
  let challenge; try { trust.verify(first, Buffer.from("stable-key")); } catch (e) { challenge = e; }
  await trust.approve({ profileId: "prod", expectedRevision: 1, challengeId: challenge.details.challengeId, action: "approve" }, "admin");
  await store.save({ ...input, logicalHostIdentity: "puzed:platform-a:vm-42", hostname: "10.0.0.99", expectedRevision: 1 });
  const moved = store.get("prod", 2); assert.ok(store.trust("prod")); assert.equal(trust.verify(moved, Buffer.from("stable-key")).accepted, true);
  assert.throws(() => trust.verify(moved, Buffer.from("changed-key")), (e) => e.code === "host-key-mismatch");
});
