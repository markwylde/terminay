import test from "node:test";
import assert from "node:assert/strict";
import { CanonicalProjectPathResolver, FileCatalog, FileServiceError } from "../dist/fileService/index.js";

function memoryCatalog() {
  const contents = new Map([
    ["/project/README.md", "- [ ] root task\n\n# Heading\n- [x] finished\n  - [ ] nested\n\n```md\n- [ ] ignored fence\n```\n"],
    ["/project/docs/guide.markdown", "# Guide\n- [ ] guide task\n"],
    ["/project/docs/sub/notes.mdown", "## Notes\n1. [x] note done\n"],
    ["/project/vendor/ignored.md", "- [ ] should not be visited\n"],
  ]);
  const entries = new Map([
    ["/project", { isDirectory: true, size: 0 }],
    ["/project/docs", { isDirectory: true, size: 0 }],
    ["/project/docs/sub", { isDirectory: true, size: 0 }],
    ["/project/vendor", { isDirectory: true, size: 0 }],
    ...[...contents].map(([path, text]) => [path, { isFile: true, size: new TextEncoder().encode(text).byteLength, mtimeMs: 10 }]),
  ]);
  const children = new Map([
    ["/project", [{ name: "README.md", isFile: true }, { name: "docs", isDirectory: true }, { name: "vendor", isDirectory: true }]],
    ["/project/docs", [{ name: "guide.markdown", isFile: true }, { name: "sub", isDirectory: true }]],
    ["/project/docs/sub", [{ name: "notes.mdown", isFile: true }]],
    ["/project/vendor", [{ name: "ignored.md", isFile: true }]],
  ]);
  const links = new Map([["/project/escape", "/outside"]]);
  const missing = (path) => Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
  const storage = {
    realpath(path) { if (links.has(path)) return links.get(path); if (!entries.has(path)) throw missing(path); return path; },
    stat(path) { const value = entries.get(path); if (!value) throw missing(path); return { ...value, isFile: value.isFile === true, isDirectory: value.isDirectory === true }; },
    lstat(path) { return links.has(path) ? { isSymbolicLink: true } : entries.has(path) ? { isSymbolicLink: false } : (() => { throw missing(path); })(); },
    readDirectory(path) { return children.get(path) ?? (() => { throw missing(path); })(); },
    readRange(path, offset, length) { return new TextEncoder().encode(contents.get(path) ?? "").slice(offset, offset + length); },
  };
  const resolver = new CanonicalProjectPathResolver("/project", storage);
  return new FileCatalog(resolver, storage, { maxEntries: 32, maxDepth: 8 });
}

test("recursive Markdown task aggregation is canonical, grouped, and ignores configured directories", async () => {
  const catalog = memoryCatalog();
  const result = await catalog.aggregateMarkdownTasks(".", { ignoredDirectories: ["vendor"] });
  assert.deepEqual(result.files.map((file) => file.relativePath), ["README.md", "docs/guide.markdown", "docs/sub/notes.mdown"]);
  assert.deepEqual(result.tasks.map((task) => task.label), ["root task", "finished", "nested", "guide task", "note done"]);
  assert.equal(result.stats.total, 5);
  assert.equal(result.stats.completed, 2);
  assert.equal(result.stats.remaining, 3);
  assert.equal(result.files[0].sections[0].title, "Heading");
  assert.deepEqual(result.files[0].tasks[2].sectionPath, ["Heading"]);
  assert.equal(result.tree.directories[0].relativePath, "docs");
  assert.equal(result.tree.stats.total, 5);
  assert.equal(result.tree.directories[0].directories[0].stats.total, 1);
});

test("task aggregation bounds bytes/depth and honours cancellation", async () => {
  const catalog = memoryCatalog();
  const bounded = await catalog.aggregateMarkdownTasks(".", { maxFileBytes: 4, maxBytes: 4 });
  assert.equal(bounded.truncated, true);
  assert.ok(bounded.readBytes <= 4);
  const fileBounded = await catalog.aggregateMarkdownTasks(".", { maxFiles: 1 });
  assert.equal(fileBounded.truncated, true);
  assert.ok(fileBounded.files.length <= 1);
  const depthBounded = await catalog.aggregateMarkdownTasks(".", { maxDepth: 1 });
  assert.equal(depthBounded.truncated, true);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => catalog.aggregateMarkdownTasks(".", { signal: controller.signal }), /aborted/i);
  await assert.rejects(() => catalog.aggregateMarkdownTasks("../outside"), (error) => error instanceof FileServiceError && error.code === "path_escape");
});

test("bounded task aggregation is independent of directory enumeration order", async () => {
  const contents = new Map([
    ["/project/alpha.md", "- [ ] alpha\n"],
    ["/project/zeta.md", "- [x] zeta\n"],
  ]);
  const entries = new Map([
    ["/project", { isDirectory: true, size: 0 }],
    ...[...contents].map(([path, text]) => [path, { isFile: true, size: new TextEncoder().encode(text).byteLength }]),
  ]);
  let reverse = false;
  const storage = {
    realpath(path) {
      if (!entries.has(path)) throw Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
      return path;
    },
    stat(path) {
      const value = entries.get(path);
      if (!value) throw Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
      return { ...value, isFile: value.isFile === true, isDirectory: value.isDirectory === true };
    },
    lstat(path) {
      if (!entries.has(path)) throw Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
      return { isSymbolicLink: false };
    },
    readDirectory() {
      const children = [
        { name: "zeta.md", isFile: true },
        { name: "alpha.md", isFile: true },
      ];
      return reverse ? children.reverse() : children;
    },
    readRange(path, offset, length) {
      return new TextEncoder().encode(contents.get(path) ?? "").slice(offset, offset + length);
    },
  };
  const resolver = new CanonicalProjectPathResolver("/project", storage);
  const catalog = new FileCatalog(resolver, storage, { maxEntries: 8, maxDepth: 4 });

  const first = await catalog.aggregateMarkdownTasks(".", { maxFiles: 1 });
  reverse = true;
  const second = await catalog.aggregateMarkdownTasks(".", { maxFiles: 1 });

  assert.equal(first.truncated, true);
  assert.equal(second.truncated, true);
  assert.deepEqual(first.files.map((file) => file.relativePath), ["alpha.md"]);
  assert.deepEqual(second.files.map((file) => file.relativePath), ["alpha.md"]);
  assert.deepEqual(first.tasks.map((task) => task.label), ["alpha"]);
  assert.deepEqual(second.tasks.map((task) => task.label), ["alpha"]);
});
