import test from "node:test";
import assert from "node:assert/strict";
import {
  CanonicalProjectPathResolver,
  FileServiceError,
  FileSession,
  FileSessionRegistry,
} from "../dist/fileService/index.js";

function memoryPathAdapter() {
  const files = new Map([
    ["/project", { isDirectory: true, isFile: false }],
    ["/project/src/main.ts", { isDirectory: false, isFile: true }],
    ["/outside", { isDirectory: true, isFile: false }],
    ["/outside/secret", { isDirectory: false, isFile: true }],
  ]);
  const links = new Map([["/project/link", "/outside"]]);
  const missing = (path) => Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
  return {
    realpath(path) {
      if (links.has(path)) return links.get(path);
      if (!files.has(path)) throw missing(path);
      return path;
    },
    stat(path) {
      const value = files.get(path);
      if (!value) throw missing(path);
      return { ...value, size: 0 };
    },
    lstat(path) {
      if (links.has(path)) return { isSymbolicLink: true };
      if (!files.has(path)) throw missing(path);
      return { isSymbolicLink: false };
    },
  };
}

test("canonical project resolver rejects traversal and symlink escapes", async () => {
  const resolver = new CanonicalProjectPathResolver("/project", memoryPathAdapter());
  assert.equal(await resolver.resolve("src/main.ts", { requireFile: true }), "/project/src/main.ts");
  await assert.rejects(resolver.resolve("../outside/secret"), (error) => error instanceof FileServiceError && error.code === "path_escape");
  await assert.rejects(resolver.resolve("link"), (error) => error instanceof FileServiceError && error.code === "path_escape");
  assert.equal(await resolver.resolve("new.txt", { allowMissing: true }), "/project/new.txt");
});

test("file sessions preserve drafts, detect disk conflicts, and require revisions", async () => {
  let disk = new Uint8Array([104, 101, 108, 108, 111]);
  const writes = [];
  const storage = {
    readRange(_path, offset, length) { return disk.slice(offset, offset + length); },
    readFile() { return disk.slice(); },
    stat() { return { size: disk.byteLength, identity: "disk-1" }; },
    atomicWrite(_path, bytes) { disk = new Uint8Array(bytes); writes.push(new Uint8Array(bytes)); },
  };
  const session = await FileSession.open("/project/src/main.ts", storage, { loadInitialBytes: true });
  assert.deepEqual([...((await session.readRange(1, 3)).bytes)], [101, 108, 108]);
  const draft = session.applyDraft(new Uint8Array([104, 105]), { expectedDraftRevision: 0 });
  assert.equal(draft.ok, true);
  assert.equal(session.state.dirty, true);
  assert.equal(session.applyDraft(new Uint8Array([120]), { expectedDraftRevision: 0 }).ok, false);
  session.observeDiskChange({ diskRevision: 2, bytes: new Uint8Array([111, 108, 100]) });
  assert.equal(session.state.conflict, true);
  assert.equal((await session.save()).ok, false);
  assert.equal(session.keepLocal().ok, true);
  assert.equal((await session.save({ expectedDiskRevision: 2, expectedDraftRevision: 1 })).ok, true);
  assert.equal(writes.length, 1);
  assert.deepEqual([...disk], [104, 105]);
});

test("dirty file sessions survive client disconnect until explicit lifecycle release", async () => {
  const registry = new FileSessionRegistry();
  const storage = { atomicWrite() {} };
  const session = registry.open("/project/a.txt", storage, { initialBytes: new Uint8Array([1]) });
  session.applyDraft(new Uint8Array([2]));
  assert.equal(registry.disconnect().length, 1);
  assert.equal(registry.release("/project/a.txt").ok, false);
  assert.equal((await registry.releaseAsync("/project/a.txt", true)).ok, true);
  assert.equal(registry.get("/project/a.txt"), undefined);
});
