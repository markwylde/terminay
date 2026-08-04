import test from "node:test";
import assert from "node:assert/strict";
import { FileSessionRegistry, FileWatchRegistry } from "../dist/fileService/index.js";

function memoryFile(initial = "base") {
  let bytes = new TextEncoder().encode(initial);
  let writes = 0;
  const storage = {
    readRange(_path, offset, length) { return bytes.slice(offset, offset + length); },
    readFile() { return bytes.slice(); },
    stat() { return { size: bytes.byteLength, identity: `disk-${bytes.byteLength}-${writes}` }; },
    atomicWrite(_path, next) { bytes = next.slice(); writes += 1; },
  };
  return { storage, get bytes() { return bytes; }, get writes() { return writes; } };
}

test("two clients share one canonical draft, observe conflicts, and save only after explicit keep-local", async () => {
  const disk = memoryFile();
  const sessions = new FileSessionRegistry();
  const first = sessions.open("/project/file.txt", disk.storage, { initialBytes: disk.bytes, initialMetadata: { size: 4, identity: "disk-1" } });
  const second = sessions.open("/project/file.txt", disk.storage);
  assert.strictEqual(second, first);

  const watches = new FileWatchRegistry({ serverId: "server-a", maxQueueEvents: 4, maxBatchEvents: 4 });
  const watchA = watches.subscribe({ clientId: "client-a", projectId: "project-a", resource: "file.txt" });
  const watchB = watches.subscribe({ clientId: "client-b", projectId: "project-a", resource: "file.txt" });

  const localEdit = first.applyDraft(new TextEncoder().encode("local-a"), { expectedDraftRevision: 0 });
  assert.equal(localEdit.ok, true);
  const staleEdit = second.applyDraft(new TextEncoder().encode("local-b"), { expectedDraftRevision: 0 });
  assert.equal(staleEdit.ok, false);
  assert.equal(staleEdit.error.code, "revision_conflict");
  assert.equal(second.metadata().draftRevision, 1);

  first.observeDiskChange({ diskRevision: 2, bytes: new TextEncoder().encode("remote"), metadata: { size: 6, identity: "disk-2" } });
  watches.publish({ projectId: "project-a", resource: "file.txt", kind: "changed", revision: 2, metadata: { size: 6, identity: "opaque-watch-id" } });
  assert.equal((await watches.read(watchA.subscriptionId)).events[0].revision, 2);
  assert.equal((await watches.read(watchB.subscriptionId)).events[0].revision, 2);

  const blocked = await second.save({ expectedDiskRevision: 2, expectedDraftRevision: 1 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, "save_precondition");
  assert.equal(second.keepLocal().ok, true);
  const saved = await first.save({ expectedDiskRevision: 2, expectedDraftRevision: 1 });
  assert.equal(saved.ok, true);
  assert.equal(saved.value.diskRevision, 3);
  assert.equal(new TextDecoder().decode(disk.bytes), "local-a");
  assert.equal(disk.writes, 1);
  watches.publish({ projectId: "project-a", resource: "file.txt", kind: "changed", revision: 3, metadata: { size: 7 } });
  assert.equal((await watches.read(watchA.subscriptionId)).events[0].revision, 3);
  assert.equal((await watches.read(watchB.subscriptionId)).events[0].revision, 3);
  assert.equal(first.metadata().conflict, false);
  assert.equal(first.metadata().dirty, false);
});

test("client disconnect retains a dirty draft and reconnect requests bounded watch resync", async () => {
  const disk = memoryFile("draft");
  const sessions = new FileSessionRegistry();
  const session = sessions.open("/project/file.txt", disk.storage, { initialBytes: disk.bytes, initialMetadata: { size: 5 } });
  assert.equal(session.applyDraft(new TextEncoder().encode("retained"), 0).ok, true);
  assert.equal(sessions.disconnect().length, 1);
  const resumed = sessions.open("/project/file.txt", disk.storage);
  assert.strictEqual(resumed, session);
  assert.equal(resumed.metadata().dirty, true);
  assert.equal(new TextDecoder().decode((await resumed.readRange(0, 8)).bytes), "retained");

  const watches = new FileWatchRegistry({ serverId: "server-a", maxQueueEvents: 2, maxBatchEvents: 2 });
  const live = watches.subscribe({ clientId: "client-a", projectId: "project-a", resource: "file.txt" });
  for (let index = 1; index <= 5; index += 1) watches.publish({ projectId: "project-a", resource: "file.txt", kind: "changed", revision: index, metadata: { size: index } });
  await watches.read(live.subscriptionId, { limit: 2 });
  watches.unsubscribe(live.subscriptionId);
  const reconnect = watches.subscribe({ clientId: "client-a", projectId: "project-a", resource: "file.txt", afterSequence: 0 });
  const batch = await watches.read(reconnect.subscriptionId);
  assert.equal(batch.events[0].kind, "resync");
  assert.equal(batch.resyncRequired, true);
  assert.equal(resumed.metadata().dirty, true);
});
