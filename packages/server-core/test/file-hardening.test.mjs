import test from "node:test";
import assert from "node:assert/strict";
import {
  CanonicalProjectPathResolver,
  FileCatalog,
  FileServiceError,
  FileSession,
} from "../dist/fileService/index.js";

function hardeningStorage() {
  let rootExists = true;
  let diskBytes = new TextEncoder().encode("original");
  let failAtomicWrite = false;
  let atomicWriteCount = 0;
  const files = new Map([
    ["/project-real/case.txt", new TextEncoder().encode("case")],
    ["/project-real/keep/visible.md", new TextEncoder().encode("visible")],
    ["/project-real/vendor/secret.md", new TextEncoder().encode("secret")],
  ]);
  const directories = new Set(["/project-real", "/project-real/keep", "/project-real/vendor"]);
  const children = new Map([
    ["/project-real", [
      { name: "Case.TXT", isFile: true },
      { name: "alias", isSymbolicLink: true },
      { name: "keep", isDirectory: true },
      { name: "vendor", isDirectory: true },
    ]],
    ["/project-real/keep", [{ name: "visible.md", isFile: true }]],
    ["/project-real/vendor", [{ name: "secret.md", isFile: true }]],
  ]);
  const links = new Map([
    ["/project-real/Case.TXT", "/project-real/case.txt"],
    ["/project-real/alias", "/outside/secret.txt"],
  ]);
  const missing = (path) => Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
  const exists = (path) => rootExists && (path === "/project-real" || directories.has(path) || files.has(path) || path === "/outside/secret.txt");
  const storage = {
    realpath(path) {
      if (!rootExists && (path === "/project" || path.startsWith("/project"))) throw missing(path);
      if (path === "/project") return "/project-real";
      if (links.has(path)) return links.get(path);
      if (exists(path)) return path;
      throw missing(path);
    },
    stat(path) {
      if (!exists(path)) throw missing(path);
      if (path === "/project-real" || directories.has(path)) return { isDirectory: true, size: 0 };
      if (path === "/outside/secret.txt") return { isFile: true, size: 6 };
      const bytes = files.get(path);
      return { isFile: true, size: bytes?.byteLength ?? 0 };
    },
    lstat(path) {
      if (links.has(path)) return { isSymbolicLink: true };
      if (!exists(path)) throw missing(path);
      return { isSymbolicLink: false };
    },
    readDirectory(path) { if (!exists(path)) throw missing(path); return children.get(path) ?? []; },
    readRange(path, offset, length) { const bytes = files.get(path) ?? diskBytes; return bytes.slice(offset, offset + length); },
    readFile(path) { const bytes = files.get(path) ?? diskBytes; return bytes.slice(); },
    atomicWrite(path, bytes) {
      if (failAtomicWrite) throw new Error("disk full");
      atomicWriteCount += 1;
      if (files.has(path)) files.set(path, bytes.slice());
      else diskBytes = bytes.slice();
    },
  };
  return {
    storage,
    setRootExists(value) { rootExists = value; },
    setAtomicWriteFailure(value) { failAtomicWrite = value; },
    get atomicWriteCount() { return atomicWriteCount; },
    get diskBytes() { return diskBytes; },
  };
}

test("canonical resolver rejects symlink escape while accepting case aliases inside the project", async () => {
  const fixture = hardeningStorage();
  const resolver = new CanonicalProjectPathResolver("/project", fixture.storage);
  assert.equal(await resolver.resolve("Case.TXT", { requireFile: true }), "/project-real/case.txt");
  await assert.rejects(() => resolver.resolve("alias", { requireFile: true }), (error) => error instanceof FileServiceError && error.code === "path_escape");
});

test("missing project roots fail closed for root and catalog operations", async () => {
  const fixture = hardeningStorage();
  const resolver = new CanonicalProjectPathResolver("/project", fixture.storage);
  const catalog = new FileCatalog(resolver, fixture.storage);
  fixture.setRootExists(false);
  await assert.rejects(() => resolver.root(), (error) => error instanceof FileServiceError && error.code === "path_missing");
  await assert.rejects(() => catalog.list("."), (error) => error instanceof FileServiceError && error.code === "path_missing");
});

test("catalog ignore patterns apply to directory entries and recursive search", async () => {
  const fixture = hardeningStorage();
  const resolver = new CanonicalProjectPathResolver("/project", fixture.storage);
  const catalog = new FileCatalog(resolver, fixture.storage, { ignoredDirectories: ["vendor"] });
  const listed = await catalog.list(".");
  assert.equal(listed.entries.some((entry) => entry.name === "vendor"), false);
  const visible = await catalog.search(".", "secret", { ignoredDirectories: ["vendor"] });
  assert.deepEqual(visible.results, []);
});

test("atomic save never mutates disk on failure and replaces once on success", async () => {
  const fixture = hardeningStorage();
  const session = new FileSession("/project-real/file.txt", fixture.storage, { initialBytes: fixture.diskBytes, initialMetadata: { size: fixture.diskBytes.byteLength }, maxDraftBytes: 64 });
  assert.equal(session.applyDraft(new TextEncoder().encode("replacement"), 0).ok, true);
  fixture.setAtomicWriteFailure(true);
  const failed = await session.save({ expectedDiskRevision: 1, expectedDraftRevision: 1 });
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "write_failed");
  assert.equal(new TextDecoder().decode(fixture.diskBytes), "original");
  assert.equal(fixture.atomicWriteCount, 0);
  assert.equal(session.dirty, true);
  fixture.setAtomicWriteFailure(false);
  const saved = await session.save({ expectedDiskRevision: 1, expectedDraftRevision: 1 });
  assert.equal(saved.ok, true);
  assert.equal(new TextDecoder().decode(fixture.diskBytes), "replacement");
  assert.equal(fixture.atomicWriteCount, 1);
  assert.equal(session.dirty, false);
});
