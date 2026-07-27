import test from "node:test";
import assert from "node:assert/strict";
import { FileServiceError, FileSession } from "../dist/fileService/index.js";

function memoryStorage(initial = "hello") {
  let bytes = new TextEncoder().encode(initial);
  let failWrites = false;
  return {
    get bytes() { return bytes; },
    set failWrites(value) { failWrites = value; },
    async readRange(_path, offset, length) { return bytes.slice(offset, offset + length); },
    async readFile() { return bytes.slice(); },
    async stat() { return { size: bytes.byteLength, identity: String(bytes.byteLength) }; },
    async atomicWrite(_path, next) {
      if (failWrites) throw new Error("disk unavailable");
      bytes = next.slice();
    },
  };
}

test("file session has ordered draft/disk revisions and bounded ranged reads", async () => {
  const storage = memoryStorage("hello world");
  const session = new FileSession("/project/file.txt", storage, { initialBytes: storage.bytes, initialMetadata: { size: 11 }, maxRangeBytes: 4 });
  assert.deepEqual([...((await session.readRange(0, 4)).bytes)], [...new TextEncoder().encode("hell")]);
  const edited = session.applyDraft(new TextEncoder().encode("HELLO world"), { expectedDraftRevision: 0 });
  assert.equal(edited.ok, true);
  assert.equal(edited.value.dirty, true);
  const stale = session.applyDraft(new TextEncoder().encode("stale"), { expectedDraftRevision: 0 });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "revision_conflict");
  await assert.rejects(() => session.readRange(0, 5), (error) => error instanceof FileServiceError && error.code === "range_too_large");
  const saved = await session.save({ expectedDiskRevision: 1, expectedDraftRevision: 1 });
  assert.equal(saved.ok, true);
  assert.equal(saved.value.diskRevision, 2);
  assert.equal(saved.value.dirty, false);
  assert.equal(new TextDecoder().decode(storage.bytes), "HELLO world");
});

test("file session exposes canonical bounded metadata without exposing content", async () => {
  const storage = memoryStorage("hello");
  const session = new FileSession("/project/file.txt", storage, {
    initialBytes: storage.bytes,
    initialMetadata: { size: 5, mtimeMs: 1234, mode: 0o644, identity: "opaque-disk-1" },
  });

  assert.deepEqual(session.metadata(), {
    canonicalPath: "/project/file.txt",
    size: 5,
    mtimeMs: 1234,
    mode: 0o644,
    diskIdentity: "opaque-disk-1",
    diskRevision: 1,
    draftRevision: 0,
    dirty: false,
    conflict: false,
    watchState: "watching",
  });

  assert.equal(session.applyDraft(new TextEncoder().encode("local"), 0).ok, true);
  const dirtyMetadata = session.metadata();
  assert.equal(dirtyMetadata.size, 5);
  assert.equal(dirtyMetadata.draftSize, 5);
  assert.equal(dirtyMetadata.dirty, true);
  assert.equal("bytes" in dirtyMetadata, false);

  session.observeDiskChange({
    bytes: new TextEncoder().encode("disk"),
    metadata: { size: 4, mtimeMs: 2345, mode: 0o600, identity: "opaque-disk-2" },
  });
  assert.deepEqual(session.metadata(), {
    canonicalPath: "/project/file.txt",
    size: 4,
    draftSize: 5,
    mtimeMs: 2345,
    mode: 0o600,
    diskIdentity: "opaque-disk-2",
    diskRevision: 2,
    draftRevision: 1,
    dirty: true,
    conflict: true,
    watchState: "conflict",
  });

  session.observeDiskChange({ diskRevision: 3 });
  const unknownMetadata = session.metadata();
  assert.equal(unknownMetadata.size, undefined);
  assert.equal(unknownMetadata.mtimeMs, undefined);
  assert.equal(unknownMetadata.mode, undefined);
  assert.equal(unknownMetadata.diskIdentity, undefined);
});

test("dirty external changes preserve the draft and require explicit keep-local before save", async () => {
  const storage = memoryStorage("one");
  const session = new FileSession("/project/file.txt", storage, { initialBytes: storage.bytes, initialMetadata: { size: 3 } });
  assert.equal(session.applyDraft(new TextEncoder().encode("local"), 0).ok, true);
  session.observeDiskChange({ bytes: new TextEncoder().encode("other") });
  assert.equal(session.state.conflict, true);
  const blocked = await session.save({ expectedDiskRevision: 2, expectedDraftRevision: 1 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, "save_precondition");
  assert.equal(session.keepLocal().ok, true);
  const saved = await session.save({ expectedDiskRevision: 2, expectedDraftRevision: 1 });
  assert.equal(saved.ok, true);
  assert.equal(new TextDecoder().decode(storage.bytes), "local");
});

test("failed atomic save and destructive reload preserve explicit preconditions", async () => {
  const storage = memoryStorage("one");
  const session = new FileSession("/project/file.txt", storage, { initialBytes: storage.bytes, initialMetadata: { size: 3 } });
  assert.equal(session.applyDraft(new TextEncoder().encode("two"), 0).ok, true);
  storage.failWrites = true;
  const failed = await session.save({ expectedDiskRevision: 1, expectedDraftRevision: 1 });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "write_failed");
  assert.equal(session.dirty, true);
  const declined = await session.reload({ confirm: false, expectedDiskRevision: 1, expectedDraftRevision: 1 });
  assert.equal(declined.ok, false);
  assert.equal(declined.error.code, "confirmation_required");
  storage.failWrites = false;
  const reloaded = await session.reload({ confirm: true, expectedDiskRevision: 1, expectedDraftRevision: 1 });
  assert.equal(reloaded.ok, true);
  assert.equal(session.dirty, false);
});
