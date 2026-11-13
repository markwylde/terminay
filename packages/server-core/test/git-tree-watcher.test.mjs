import assert from "node:assert/strict";
import { watch as nodeWatch } from "node:fs";
import { lstat, mkdir, mkdtemp, opendir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { eventually, settle } from "./fixtures/git-observation.mjs";

/** The built-up watch runs only on Linux, where per-directory fs.watch is
 *  inotify. On macOS it is FSEvents, which may report nested names and misses
 *  events just after a stream starts, so event-driven cases run on Linux
 *  only (CI runs the workspace suites on Linux). */
const linuxOnly = process.platform === "linux" ? {} : { skip: "built-up watches run only on Linux (inotify)" };

/**
 * The built-up (Linux) recursive watch, run on every OS through injection
 * against the real filesystem. The counting fs records which directories are
 * watched, so "never watched" and "closed again" are assertions.
 */
async function startTreeWatch(t, { filter, limits, layout = {}, fsOverrides = {} } = {}) {
  const { createTreeWatch } = await import("../dist/gitService/treeWatch.js");
  const root = await realpath(await mkdtemp(join(tmpdir(), "terminay-tree-watch-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(layout)) {
    const full = join(root, path);
    if (content === null) await mkdir(full, { recursive: true });
    else {
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, content);
    }
  }
  const watched = new Map();
  const filterCalls = [];
  const fs = {
    watch(path, options, listener) {
      if (fsOverrides.watch) {
        const overridden = fsOverrides.watch(path);
        if (overridden) return overridden;
      }
      const watcher = nodeWatch(path, options, listener);
      const rel = relative(root, path);
      watched.set(rel, watcher);
      watcher.on("close", () => {
        if (watched.get(rel) === watcher) watched.delete(rel);
      });
      return watcher;
    },
    lstat: (path) => lstat(path),
    opendir: (path, options) => opendir(path, options),
  };
  const changes = [];
  const errors = [];
  const handle = createTreeWatch(
    root,
    {
      recursive: true,
      onChange: (entry) => changes.push(entry),
      onError: (error) => errors.push(error),
      filterDirectories: filter
        ? async (dirs, signal) => {
            filterCalls.push([...dirs]);
            return filter(dirs, signal);
          }
        : undefined,
    },
    { fs, limits },
  );
  t.after(() => handle.close());
  const context = {
    root,
    handle,
    changes,
    errors,
    watched,
    filterCalls,
    watchedPaths: () => [...watched.keys()].sort(),
    /** Wait until the watched set stops changing. */
    async quiet() {
      let last = "";
      let stableSince = Date.now();
      await eventually(() => {
        const now = context.watchedPaths().join("|");
        if (now !== last) {
          last = now;
          stableSince = Date.now();
        }
        return Date.now() - stableSince > 150;
      }, "the watch never settled");
    },
  };
  return context;
}

const ignoring = (...names) => async (dirs) => dirs.filter((dir) => !names.some((name) => dir === name || dir.endsWith(`/${name}`)));

test("a file save in a watched directory is delivered", linuxOnly, async (t) => {
  const w = await startTreeWatch(t, { layout: { "src/a.txt": "a" } });
  await w.quiet();
  assert.deepEqual(w.watchedPaths(), ["", "src"]);
  await writeFile(join(w.root, "src", "a.txt"), "edited");
  await eventually(() => w.changes.includes(join("src", "a.txt")), "the save was not delivered");
  assert.deepEqual(w.errors, []);
});

test("a new directory is taken up and a file saved inside it is delivered", linuxOnly, async (t) => {
  const w = await startTreeWatch(t);
  await w.quiet();
  await mkdir(join(w.root, "fresh", "deep"), { recursive: true });
  await writeFile(join(w.root, "fresh", "deep", "b.txt"), "b");
  await eventually(() => w.watched.has(join("fresh", "deep")), "the new directory was not watched");
  w.changes.length = 0;
  await writeFile(join(w.root, "fresh", "deep", "b.txt"), "again");
  await eventually(() => w.changes.includes(join("fresh", "deep", "b.txt")), "the later save was not delivered");
});

test("filtered directories are never watched and their churn is not delivered", linuxOnly, async (t) => {
  const w = await startTreeWatch(t, {
    filter: ignoring("dist", "node_modules"),
    layout: { "dist/x/y": null, "node_modules/pkg/index.js": "x", "src/a.txt": "a" },
  });
  await w.quiet();
  assert.deepEqual(w.watchedPaths(), ["", "src"]);
  w.changes.length = 0;
  for (let round = 0; round < 3; round++) {
    await rm(join(w.root, "dist"), { recursive: true, force: true });
    await mkdir(join(w.root, "dist", "a", "b"), { recursive: true });
  }
  await settle(300);
  assert.deepEqual(w.changes, [], "ignored churn reached onChange");
  assert.deepEqual(w.watchedPaths(), ["", "src"]);
});

test("a deleted untracked file is delivered", linuxOnly, async (t) => {
  const w = await startTreeWatch(t, { layout: { "gone.txt": "x" } });
  await w.quiet();
  await rm(join(w.root, "gone.txt"));
  await eventually(() => w.changes.includes("gone.txt"), "the deletion was not delivered");
});

test("a populated directory renamed within the tree is followed", linuxOnly, async (t) => {
  const w = await startTreeWatch(t, { layout: { "old/inner/f.txt": "f" } });
  await w.quiet();
  await rename(join(w.root, "old"), join(w.root, "new"));
  await eventually(() => w.watched.has(join("new", "inner")), "the renamed tree was not watched");
  await eventually(() => !w.watched.has("old") && !w.watched.has(join("old", "inner")), "the old path stayed watched");
  w.changes.length = 0;
  await writeFile(join(w.root, "new", "inner", "f.txt"), "edited");
  await eventually(() => w.changes.includes(join("new", "inner", "f.txt")), "a save after the rename was not delivered");
  assert.deepEqual(w.errors, []);
});

test("a directory deleted and recreated at the same path is re-armed", linuxOnly, async (t) => {
  const w = await startTreeWatch(t, { layout: { "d/f.txt": "f" } });
  await w.quiet();
  const before = w.watched.get("d");
  await rm(join(w.root, "d"), { recursive: true });
  await mkdir(join(w.root, "d"));
  await eventually(() => w.watched.has("d") && w.watched.get("d") !== before, "the replaced directory was not re-armed");
  w.changes.length = 0;
  await writeFile(join(w.root, "d", "g.txt"), "g");
  await eventually(() => w.changes.includes(join("d", "g.txt")), `a save in the new directory was not delivered: ${JSON.stringify(w.changes)} watched=${w.watchedPaths()} errors=${w.errors}`);
  assert.deepEqual(w.errors, []);
});

test("deleting a watched subtree closes its watches", linuxOnly, async (t) => {
  const w = await startTreeWatch(t, { layout: { "a/b/c/d": null, "keep/x.txt": "x" } });
  await w.quiet();
  assert.equal(w.watched.size, 6);
  await rm(join(w.root, "a"), { recursive: true });
  await eventually(() => w.watched.size === 2, `watches leaked: ${w.watchedPaths().join(",")}`);
  assert.deepEqual(w.errors, []);
});

test("an unexpected error on a subdirectory watch fails the whole watch once", async (t) => {
  const w = await startTreeWatch(t, { layout: { "a/b": null } });
  await w.quiet();
  w.watched.get("a").emit("error", Object.assign(new Error("inotify broke"), { code: "EIO" }));
  await eventually(() => w.errors.length === 1, "the watch did not fail");
  await settle(100);
  assert.equal(w.errors.length, 1);
  assert.equal(w.errors[0].code, "EIO");
  assert.deepEqual(w.watchedPaths(), [], "watches stayed open after failure");
});

test("a nested repository is a boundary", async (t) => {
  const w = await startTreeWatch(t, {
    filter: async (dirs) => dirs,
    layout: { "sub/.git/HEAD": "ref: refs/heads/main\n", "sub/inner/f.txt": "f", "src/a.txt": "a" },
  });
  await w.quiet();
  assert.deepEqual(w.watchedPaths(), ["", "src"]);
  assert.ok(!w.filterCalls.flat().some((dir) => dir.startsWith(`sub/`)), "a path inside the nested repository reached the filter");
  assert.deepEqual(w.errors, []);
});

test("refilter takes up a directory that is no longer excluded, and closes one that now is", linuxOnly, async (t) => {
  let ignored = new Set(["build"]);
  const w = await startTreeWatch(t, {
    filter: async (dirs) => dirs.filter((dir) => !ignored.has(dir)),
    layout: { "build/out": null, "src/a.txt": "a" },
  });
  await w.quiet();
  assert.deepEqual(w.watchedPaths(), ["", "src"]);
  ignored = new Set(["src"]);
  w.handle.refilter("rules");
  await eventually(() => w.watched.has(join("build", "out")) && !w.watched.has("src"), `refilter did not converge: ${w.watchedPaths().join(",")}`);
  w.changes.length = 0;
  await writeFile(join(w.root, "build", "out", "f.txt"), "f");
  await eventually(() => w.changes.includes(join("build", "out", "f.txt")), "a save in the un-ignored directory was not delivered");
});

test("tracking refilter re-checks only excluded directories", async (t) => {
  const w = await startTreeWatch(t, { filter: ignoring("vendor"), layout: { "vendor/x": null, "src/y": null } });
  await w.quiet();
  w.filterCalls.length = 0;
  w.handle.refilter("tracking");
  await eventually(() => w.filterCalls.length > 0, "refilter asked nothing");
  await settle(100);
  assert.deepEqual(w.filterCalls.flat(), ["vendor"]);
});

test("exceeding the directory ceiling fails with ETOOMANYDIRS naming the ceiling", async (t) => {
  const layout = {};
  for (let index = 0; index < 12; index++) layout[`d${index}`] = null;
  const w = await startTreeWatch(t, { layout, limits: { maxDirectories: 8 } });
  await eventually(() => w.errors.length === 1, "the ceiling did not fail the watch");
  assert.equal(w.errors[0].code, "ETOOMANYDIRS");
  assert.match(w.errors[0].message, /8/);
  await settle(50);
  assert.deepEqual(w.watchedPaths(), []);
});

for (const code of ["ENOSPC", "EMFILE"]) {
  test(`a host watch refusal (${code}) fails the watch with that code`, async (t) => {
    const w = await startTreeWatch(t, {
      layout: { "a/b": null },
      fsOverrides: {
        watch(path) {
          if (path.endsWith(`${"/"}b`)) throw Object.assign(new Error(`watch refused`), { code });
          return undefined;
        },
      },
    });
    await eventually(() => w.errors.length === 1, "the refusal did not fail the watch");
    assert.equal(w.errors[0].code, code);
  });
}

test("a filter rejection fails the watch", async (t) => {
  const w = await startTreeWatch(t, {
    filter: async () => {
      throw Object.assign(new Error("check-ignore failed"), { code: "EGITIGNORE" });
    },
    layout: { "a/b": null },
  });
  await eventually(() => w.errors.length === 1, "the rejection did not fail the watch");
  assert.equal(w.errors[0].code, "EGITIGNORE");
});

test("a filter answer naming a path it was not asked about fails the watch", async (t) => {
  const w = await startTreeWatch(t, { filter: async () => ["elsewhere"], layout: { a: null } });
  await eventually(() => w.errors.length === 1, "the bad answer did not fail the watch");
  assert.equal(w.errors[0].code, "EFILTER");
});

test("closing during discovery stops all later work", async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const layout = {};
  for (let index = 0; index < 20; index++) layout[`d${index}/e`] = null;
  const w = await startTreeWatch(t, {
    filter: async (dirs) => {
      await gate;
      return dirs;
    },
    layout,
  });
  await eventually(() => w.filterCalls.length === 1, "discovery never reached the filter");
  w.handle.close();
  const callsAtClose = w.filterCalls.length;
  release();
  await settle(200);
  assert.deepEqual(w.watchedPaths(), [], "a watch was opened after close");
  assert.equal(w.filterCalls.length, callsAtClose, "the filter was called after close");
  assert.deepEqual(w.changes, []);
  assert.deepEqual(w.errors, []);
});

/** Run `work` while a 50 ms interval measures how late the event loop lets it fire. */
async function maxTimerLag(work) {
  let worst = 0;
  let expected = performance.now() + 50;
  const timer = setInterval(() => {
    const now = performance.now();
    worst = Math.max(worst, now - expected);
    expected = now + 50;
  }, 50);
  try {
    await work();
  } finally {
    clearInterval(timer);
  }
  return worst;
}

test("thousands of directories appearing at once never stall the event loop", { ...linuxOnly, timeout: 120_000 }, async (t) => {
  const w = await startTreeWatch(t, { filter: async (dirs) => dirs });
  await w.quiet();
  const lag = await maxTimerLag(async () => {
    const staging = await mkdtemp(join(tmpdir(), "terminay-tree-staging-"));
    t.after(() => rm(staging, { recursive: true, force: true }));
    for (let a = 0; a < 30; a++) for (let b = 0; b < 100; b++) await mkdir(join(staging, "tree", `a${a}`, `b${b}`), { recursive: true });
    await rename(join(staging, "tree"), join(w.root, "tree"));
    await eventually(() => w.watched.size === 1 + 1 + 30 + 3000, `only ${w.watched.size} watched`, 60_000);
  });
  assert.ok(lag < 250, `a timer fired ${Math.round(lag)} ms late`);
  assert.deepEqual(w.errors, []);
});

test("one very wide directory is read across bounded steps", { ...linuxOnly, timeout: 120_000 }, async (t) => {
  const staging = await mkdtemp(join(tmpdir(), "terminay-tree-wide-"));
  t.after(() => rm(staging, { recursive: true, force: true }));
  await mkdir(join(staging, "wide"));
  for (let index = 0; index < 30_000; index += 500)
    await Promise.all(Array.from({ length: 500 }, (_, offset) => writeFile(join(staging, "wide", `f${index + offset}`), "")));
  await mkdir(join(staging, "wide", "zz-last"));
  const w = await startTreeWatch(t);
  await w.quiet();
  const lag = await maxTimerLag(async () => {
    await rename(join(staging, "wide"), join(w.root, "wide"));
    await eventually(() => w.watched.has(join("wide", "zz-last")), "the wide directory was never fully read", 60_000);
  });
  assert.ok(lag < 250, `a timer fired ${Math.round(lag)} ms late`);
});
