import test from "node:test";
import assert from "node:assert/strict";
import { CanonicalProjectPathResolver, FileServiceError } from "../dist/fileService/index.js";

function fakePaths() {
  const links = new Map([
    ["/project", "/project-real"],
    ["/project-real/alias", "/outside/alias"],
    ["/project-real/Case.TXT", "/project-real/case.txt"],
  ]);
  const files = new Set(["/project-real/case.txt", "/project-real/readme.md"]);
  const dirs = new Set(["/project-real", "/project-real/new"]);
  const adapter = {
    async realpath(path) {
      if (path === "/project-real/new/file.txt") { const error = new Error("missing"); error.code = "ENOENT"; throw error; }
      return links.get(path) ?? path;
    },
    async stat(path) {
      if (path === "/project-real" || dirs.has(path)) return { isDirectory: true };
      if (files.has(path) || path === "/outside/alias") return { isFile: true };
      const error = new Error("missing"); error.code = "ENOENT"; throw error;
    },
    async lstat(path) {
      if (path === "/project-real/alias") return { isSymbolicLink: true };
      const error = new Error("missing"); error.code = "ENOENT"; throw error;
    },
  };
  return adapter;
}

test("canonical resolver rejects traversal and symlink escape at the final boundary", async () => {
  const resolver = new CanonicalProjectPathResolver("/project", fakePaths());
  assert.equal(await resolver.resolve("Case.TXT", { requireFile: true }), "/project-real/case.txt");
  await assert.rejects(() => resolver.resolve("../outside"), (error) => error instanceof FileServiceError && error.code === "path_escape");
  await assert.rejects(() => resolver.resolve("alias"), (error) => error instanceof FileServiceError && error.code === "path_escape");
});

test("allowMissing canonicalizes the nearest existing parent and remains project scoped", async () => {
  const resolver = new CanonicalProjectPathResolver("/project", fakePaths());
  assert.equal(await resolver.resolve("new/file.txt", { allowMissing: true }), "/project-real/new/file.txt");
  await assert.rejects(() => resolver.resolve("new/file.txt"), (error) => error instanceof FileServiceError && error.code === "path_missing");
});

