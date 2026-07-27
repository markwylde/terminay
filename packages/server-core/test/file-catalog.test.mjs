import test from "node:test";
import assert from "node:assert/strict";
import { CanonicalProjectPathResolver, FileCatalog, FileServiceError } from "../dist/fileService/index.js";

function memoryCatalog() {
  const entries = new Map([
    ["/project", { isDirectory: true, size: 0 }],
    ["/project/src", { isDirectory: true, size: 0 }],
    ["/project/src/main.ts", { isFile: true, size: 5, mtimeMs: 10 }],
    ["/project/src/util.ts", { isFile: true, size: 7, mtimeMs: 11 }],
    ["/project/README.md", { isFile: true, size: 14, mtimeMs: 12 }],
    ["/project/image.png", { isFile: true, size: 8, mtimeMs: 13 }],
    ["/project/document.pdf", { isFile: true, size: 9, mtimeMs: 14 }],
    ["/project/blob.bin", { isFile: true, size: 3, mtimeMs: 15 }],
    ["/project/bad.md", { isFile: true, size: 1, mtimeMs: 15 }],
    ["/project/huge.txt", { isFile: true, size: 100 * 1024 * 1024 + 1, mtimeMs: 16 }],
    ["/project/node_modules", { isDirectory: true, size: 0 }],
    ["/project/node_modules/ignored.js", { isFile: true, size: 99 }],
    ["/outside", { isDirectory: true, size: 0 }],
  ]);
  const links = new Map([["/project/link", "/outside"], ["/project/internal-link", "/project/src"]]);
  const children = new Map([
    ["/project", [{ name: "src", isDirectory: true }, { name: "node_modules", isDirectory: true }, { name: "link", isSymbolicLink: true }, { name: "internal-link", isSymbolicLink: true }]],
    ["/project/src", [{ name: "util.ts", isFile: true }, { name: "main.ts", isFile: true }]],
    ["/project/node_modules", [{ name: "ignored.js", isFile: true }]],
    ["/outside", []],
  ]);
  const missing = (path) => Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
  const canonical = (path) => {
    if (links.has(path)) return links.get(path);
    if (!entries.has(path)) throw missing(path);
    return path;
  };
  const storage = {
    realpath: canonical,
    stat(path) { const value = entries.get(path); if (!value) throw missing(path); return { ...value, isFile: value.isFile === true, isDirectory: value.isDirectory === true }; },
    lstat(path) { if (links.has(path)) return { isSymbolicLink: true }; return entries.has(path) ? { isSymbolicLink: false } : (() => { throw missing(path); })(); },
    readDirectory(path) { return children.get(path) ?? (() => { throw missing(path); })(); },
    readRange(path, offset, length) {
      const contents = {
        "/project/README.md": new TextEncoder().encode("# Hello\nworld\n"),
        "/project/image.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        "/project/document.pdf": new TextEncoder().encode("%PDF-1.7\n"),
        "/project/blob.bin": new Uint8Array([0, 1, 2]),
        "/project/bad.md": new Uint8Array([0xff]),
      };
      return (contents[path] ?? new Uint8Array()).slice(offset, offset + length);
    },
    atomicWrite(path, bytes) { entries.set(path, { isFile: true, size: bytes.byteLength }); },
    makeDirectory(path) { entries.set(path, { isDirectory: true, size: 0 }); children.set(path, []); },
    rename(from, to) { const value = entries.get(from); if (!value) throw missing(from); entries.delete(from); entries.set(to, value); },
    remove(path) { entries.delete(path); children.delete(path); },
  };
  const resolver = new CanonicalProjectPathResolver("/project", storage);
  return { catalog: new FileCatalog(resolver, storage, { maxEntries: 32, maxDepth: 8 }), storage };
}

test("catalog lists canonical metadata with bounded pagination and marks escaped symlinks", async () => {
  const { catalog } = memoryCatalog();
  const page = await catalog.list(".");
  assert.deepEqual(page.entries.map((entry) => entry.name), ["src", "internal-link", "link"]);
  const external = page.entries.find((entry) => entry.name === "link");
  const internal = page.entries.find((entry) => entry.name === "internal-link");
  assert.equal(external?.kind, "symlink");
  assert.equal(external?.accessible, false);
  assert.equal(internal?.kind, "symlink");
  assert.equal(internal?.accessible, true);
  const limited = await catalog.list("src", { limit: 1 });
  assert.equal(limited.entries.length, 1);
  assert.equal(limited.truncated, true);
  assert.equal(limited.nextOffset, 1);
});

test("catalog search and size are project scoped, ignore configured directories, and stay bounded", async () => {
  const { catalog } = memoryCatalog();
  const search = await catalog.search(".", "main");
  assert.deepEqual(search.results.map((entry) => entry.relativePath), ["src/main.ts"]);
  const ignored = await catalog.search(".", "ignored");
  assert.equal(ignored.results.length, 0);
  const size = await catalog.size(".", { maxEntries: 2 });
  assert.equal(size.truncated, true);
  assert.ok(size.bytes <= 12);
  await assert.rejects(() => catalog.search("../outside", "secret"), (error) => error instanceof FileServiceError && error.code === "path_escape");
});

test("catalog mutations require canonical parents and reject root/traversal operations", async () => {
  const { catalog, storage } = memoryCatalog();
  await catalog.createFile("src/new.ts", new Uint8Array([1, 2]));
  assert.equal(storage.stat("/project/src/new.ts").size, 2);
  await catalog.createDirectory("src/new-dir");
  await catalog.rename("src/new.ts", "src/renamed.ts");
  assert.throws(() => storage.stat("/project/src/new.ts"), /ENOENT/);
  await catalog.delete("src/renamed.ts");
  assert.throws(() => storage.stat("/project/src/renamed.ts"), /ENOENT/);
  await assert.rejects(() => catalog.delete("."), (error) => error instanceof FileServiceError && error.code === "path_escape");
  await assert.rejects(() => catalog.delete("internal-link"), (error) => error instanceof FileServiceError && error.code === "path_escape");
  await assert.rejects(() => catalog.createFile("../escape"), (error) => error instanceof FileServiceError && error.code === "path_escape");
});

test("catalog operations honour cancellation before traversing", async () => {
  const { catalog } = memoryCatalog();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => catalog.search(".", "src", { signal: controller.signal }), /aborted/i);
  await assert.rejects(() => catalog.size(".", { signal: controller.signal }), /aborted/i);
});

test("catalog preview metadata is canonical, bounded, and content-free", async () => {
  const { catalog } = memoryCatalog();
  const markdown = await catalog.previewMetadata("README.md");
  assert.equal(markdown.relativePath, "README.md");
  assert.equal(markdown.previewKind, "markdown");
  assert.equal(markdown.mimeType, "text/markdown");
  assert.equal(markdown.safePreview, true);
  assert.equal(markdown.canEditText, true);
  assert.equal(markdown.inspectedBytes, 14);
  assert.equal("bytes" in markdown, false);

  const image = await catalog.previewMetadata("image.png");
  assert.equal(image.previewKind, "image");
  assert.equal(image.isBinary, true);
  assert.equal(image.canEditHex, true);
  assert.equal(image.preferredMode, "preview");

  const pdf = await catalog.previewMetadata("document.pdf");
  assert.equal(pdf.previewKind, "pdf");
  assert.equal(pdf.mimeType, "application/pdf");
  assert.equal(pdf.safePreview, true);

  const binary = await catalog.previewMetadata("blob.bin");
  assert.equal(binary.previewKind, "hex");
  assert.equal(binary.safePreview, false);
  assert.equal(binary.preferredMode, "hex");

  const malformed = await catalog.previewMetadata("bad.md");
  assert.equal(malformed.previewKind, "hex");
  assert.equal(malformed.canEditText, false);

  const huge = await catalog.previewMetadata("huge.txt");
  assert.equal(huge.isLargeFile, true);
  assert.equal(huge.safePreview, false);
  assert.equal(huge.preferredMode, "text");
  assert.equal(huge.inspectionTruncated, true);
  await assert.rejects(() => catalog.previewMetadata("../outside/secret"), (error) => error instanceof FileServiceError && error.code === "path_escape");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => catalog.previewMetadata("README.md", { signal: controller.signal }), /aborted/i);
});
