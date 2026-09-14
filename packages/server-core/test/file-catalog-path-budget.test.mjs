import test from "node:test";
import assert from "node:assert/strict";
import { CanonicalProjectPathResolver, FileCatalog } from "../dist/fileService/index.js";

/**
 * A listing used to re-canonicalize the project root for every entry it
 * described, so one directory read walked the whole ancestor chain dozens of
 * times. That is invisible in this process's CPU but is what an endpoint
 * security agent sees, so the budget is asserted here rather than left to a
 * profiler.
 */
function countingProject(entryCount) {
  const names = Array.from({ length: entryCount }, (_, index) => `file-${index}.ts`);
  const entries = new Map([["/project", { isDirectory: true, size: 0 }]]);
  for (const name of names) entries.set(`/project/${name}`, { isFile: true, size: 1, mtimeMs: 1 });
  const missing = (path) => Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
  const counts = { realpath: 0, stat: 0, lstat: 0, readDirectory: 0 };
  const storage = {
    realpath(path) {
      counts.realpath += 1;
      if (!entries.has(path)) throw missing(path);
      return path;
    },
    stat(path) {
      counts.stat += 1;
      const value = entries.get(path);
      if (!value) throw missing(path);
      return { ...value, isFile: value.isFile === true, isDirectory: value.isDirectory === true };
    },
    lstat(path) {
      counts.lstat += 1;
      if (!entries.has(path)) throw missing(path);
      return { isSymbolicLink: false };
    },
    readDirectory(path) {
      counts.readDirectory += 1;
      if (path !== "/project") throw missing(path);
      return names.map((name) => ({ name, isFile: true, isDirectory: false, isSymbolicLink: false }));
    },
  };
  const resolver = new CanonicalProjectPathResolver("/project", storage);
  return { catalog: new FileCatalog(resolver, storage, { maxEntries: 512, maxDepth: 8 }), counts, resolver };
}

test("listing a directory costs a bounded number of path lookups per entry", async () => {
  const entryCount = 40;
  const { catalog, counts } = countingProject(entryCount);
  const page = await catalog.list(".");
  assert.equal(page.entries.length, entryCount);

  // One canonicalization of the root, then one per entry. Anything more means
  // the root is being re-resolved inside the loop again.
  assert.ok(
    counts.realpath <= entryCount + 2,
    `realpath called ${counts.realpath} times for ${entryCount} entries`,
  );
  // A dirent that already reports link-ness must not be re-checked with lstat.
  assert.equal(counts.lstat, 0);
  assert.equal(counts.readDirectory, 1);
  assert.ok(
    counts.stat <= 2 * entryCount + 2,
    `stat called ${counts.stat} times for ${entryCount} entries`,
  );
});

test("each listing re-canonicalizes the project root exactly once", async () => {
  const entryCount = 4;
  const { catalog, counts } = countingProject(entryCount);
  await catalog.list(".");
  const afterFirst = counts.realpath;
  await catalog.list(".");
  // The root is never cached across operations: a root replaced between two
  // listings has to be caught by the second one. What must not come back is the
  // per-entry repetition inside a single listing.
  assert.equal(counts.realpath - afterFirst, afterFirst);
  assert.ok(afterFirst <= entryCount + 2);
});
