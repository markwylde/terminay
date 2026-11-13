import assert from "node:assert/strict";
import { watch as nodeWatch } from "node:fs";
import { lstat, mkdir, opendir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createReportLog, createRepository, eventually, git, settle } from "./fixtures/git-observation.mjs";

/** The built-up watch runs only on Linux, where per-directory fs.watch is
 *  inotify. On macOS it is FSEvents, which may report nested names and misses
 *  events just after a stream starts, so event-driven cases run on Linux
 *  only (CI runs the workspace suites on Linux). */
const linuxOnly = process.platform === "linux" ? {} : { skip: "built-up watches run only on Linux (inotify)" };

/**
 * The Git service with the built-up (Linux) recursive watch, against real
 * repositories, on any OS. Proves what ADR-0113 promises at the service
 * boundary: ignored churn schedules nothing, Git decides what is ignored,
 * ignore inputs re-filter, nested worktrees keep their own watch, and any
 * failure falls into on-demand measurement.
 */
async function observe(t, fixture, { runner, fs, flushMs = 50 } = {}) {
  const { GitService, NodeGitStateWatcher, NodeGitCommandRunner } = await import("../dist/gitService/index.js");
  const log = createReportLog();
  const calls = [];
  const inner = runner ?? new NodeGitCommandRunner();
  const service = new GitService({
    watcher: new NodeGitStateWatcher({ platform: "linux", treeWatch: fs ? { fs } : undefined }),
    observationFlushMs: flushMs,
    onObservation: (report) => log.onObservation(report),
    runner: {
      run(args, cwd, options) {
        calls.push({ args: [...args], cwd });
        return inner.run(args, cwd, options);
      },
    },
  });
  t.after(() => service.close());
  const events = [];
  service.subscribe((event) => events.push(event));
  await service.bindProject("project-a", fixture.main);
  await log.until((reports) => reports.some((report) => report.kind === "watch.opened" && report.watch === "git-directory"));
  await service.worktrees({ projectId: "project-a" });
  return { service, log, calls, events };
}

/** Working-tree changes counted in every report from `from` on. */
function workingTreeChanges(log, from) {
  return log.reports
    .slice(from)
    .filter((report) => report.kind === "changes" || report.kind === "measurement.completed")
    .reduce((sum, report) => sum + (report.changes?.byClass?.["working-tree"] ?? 0), 0);
}

async function repositoryWith(files) {
  const fixture = await createRepository("terminay-built-watch-");
  for (const [path, content] of Object.entries(files)) {
    const full = join(fixture.main, path);
    if (content === null) await mkdir(full, { recursive: true });
    else {
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, content);
    }
  }
  return fixture;
}

/** Let the initial discovery finish: no new working-tree watch work for a while. */
async function discovered(context) {
  await settle(400);
  context.log.reports.length = 0;
}

test("churn in an ignored build directory schedules no refresh", linuxOnly, async (t) => {
  const fixture = await repositoryWith({ ".gitignore": "dist/\nnode_modules/\n", "dist/old/x.js": "x", "node_modules/p/i.js": "i", "src/a.txt": "a" });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await git(["add", ".gitignore", "src"], fixture.main);
  await git(["commit", "-m", "ignore"], fixture.main);
  const context = await observe(t, fixture);
  await discovered(context);
  // A build: thousands of directories created and deleted, while a timer on
  // the server's event loop measures how late it is allowed to fire.
  let worst = 0;
  let expected = performance.now() + 50;
  const timer = setInterval(() => {
    const now = performance.now();
    worst = Math.max(worst, now - expected);
    expected = now + 50;
  }, 50);
  try {
    for (let round = 0; round < 3; round++) {
      await rm(join(fixture.main, "dist"), { recursive: true, force: true });
      for (let index = 0; index < 500; index++)
        await mkdir(join(fixture.main, "dist", `chunk${index}`, "nested", "deeper"), { recursive: true });
    }
    await settle(600);
  } finally {
    clearInterval(timer);
  }
  assert.ok(worst < 250, `a timer fired ${Math.round(worst)} ms late during the build`);
  assert.equal(workingTreeChanges(context.log, 0), 0, "ignored churn was counted as a working-tree change");
  assert.ok(!context.log.reports.some((report) => report.kind === "measurement.completed"), "ignored churn scheduled a measurement");
  assert.ok(!context.calls.some((call) => call.args.includes("check-ignore") && call.args.some((arg) => arg.startsWith("dist/"))), "a path inside an ignored directory reached check-ignore");
});

test("a save in a non-ignored directory refreshes its worktree", linuxOnly, async (t) => {
  const fixture = await repositoryWith({ ".gitignore": "dist/\n", "src/deep/a.txt": "a" });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const context = await observe(t, fixture);
  await discovered(context);
  await writeFile(join(fixture.main, "src", "deep", "a.txt"), "edited");
  await context.log.until(() => workingTreeChanges(context.log, 0) > 0);
});

test("a linked worktree inside an ignored directory keeps its own watch", linuxOnly, async (t) => {
  const fixture = await repositoryWith({ ".gitignore": ".claude/\n" });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await git(["add", ".gitignore"], fixture.main);
  await git(["commit", "-m", "ignore .claude"], fixture.main);
  const linked = join(fixture.main, ".claude", "worktrees", "feature");
  await mkdir(join(fixture.main, ".claude", "worktrees"), { recursive: true });
  await git(["worktree", "add", "-b", "feature", linked], fixture.main);
  const context = await observe(t, fixture);
  await context.log.until((reports) => reports.filter((report) => report.kind === "watch.opened" && report.watch === "working-tree").length === 2);
  await discovered(context);
  await writeFile(join(linked, "a.txt"), "edited in the linked worktree");
  await context.log.until(() => workingTreeChanges(context.log, 0) > 0);
});

test("removing an ignore rule takes the directory up", linuxOnly, async (t) => {
  const fixture = await repositoryWith({ ".gitignore": "build/\n", "build/out/f.txt": "f" });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const context = await observe(t, fixture);
  await discovered(context);
  await writeFile(join(fixture.main, "build", "out", "f.txt"), "while ignored");
  await settle(400);
  assert.equal(workingTreeChanges(context.log, 0), 0, "a save in an ignored directory was observed");
  await writeFile(join(fixture.main, ".gitignore"), "");
  await settle(500);
  const from = context.log.reports.length;
  await writeFile(join(fixture.main, "build", "out", "f.txt"), "after un-ignore");
  await context.log.until(() => workingTreeChanges(context.log, from) > 0);
});

test("force-adding an ignored directory's file takes the directory up", linuxOnly, async (t) => {
  const fixture = await repositoryWith({ ".gitignore": "vendor/\n", "vendor/keep.txt": "k" });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await git(["add", ".gitignore"], fixture.main);
  await git(["commit", "-m", "ignore vendor"], fixture.main);
  const context = await observe(t, fixture);
  await discovered(context);
  await git(["add", "-f", "vendor/keep.txt"], fixture.main);
  await git(["commit", "-m", "track vendor/keep.txt"], fixture.main);
  await settle(600);
  const from = context.log.reports.length;
  await writeFile(join(fixture.main, "vendor", "keep.txt"), "edited");
  await context.log.until(() => workingTreeChanges(context.log, from) > 0);
});

test("a host watch refusal makes observation unavailable and listings measured on demand", async (t) => {
  const fixture = await repositoryWith({ "src/a.txt": "a" });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const fs = {
    watch(path, options, listener) {
      if (path.endsWith(`${"/"}src`)) throw Object.assign(new Error("inotify watch limit reached"), { code: "ENOSPC" });
      return nodeWatch(path, options, listener);
    },
    lstat: (path) => lstat(path),
    opendir: (path, options) => opendir(path, options),
  };
  const { GitService, NodeGitStateWatcher } = await import("../dist/gitService/index.js");
  const log = createReportLog();
  const service = new GitService({
    watcher: new NodeGitStateWatcher({ platform: "linux", treeWatch: { fs } }),
    onObservation: (report) => log.onObservation(report),
  });
  t.after(() => service.close());
  const events = [];
  service.subscribe((event) => events.push(event));
  await service.bindProject("project-a", fixture.main);
  const failed = await log.next("watch.failed");
  assert.equal(failed.watch, "working-tree");
  assert.equal(failed.error.code, "ENOSPC");
  await eventually(() => events.length > 0, "no status-change event was published");
  const before = log.reports.filter((report) => report.kind === "measurement.completed").length;
  await service.worktrees({ projectId: "project-a" });
  await service.worktrees({ projectId: "project-a" });
  const after = log.reports.filter((report) => report.kind === "measurement.completed").length;
  assert.ok(after - before >= 2, "listings were not measured on demand");
});

for (const [name, answer] of [
  ["a failing exit", { stdout: "", stderr: "fatal: broken", exitCode: 128, truncated: false }],
  ["truncated output", { stdout: "src\n", stderr: "", exitCode: 0, truncated: true }],
  ["a path it was not asked about", { stdout: "elsewhere\n", stderr: "", exitCode: 0, truncated: false }],
]) {
  test(`check-ignore with ${name} fails the working-tree watch`, async (t) => {
    const fixture = await repositoryWith({ "src/a.txt": "a" });
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    const { NodeGitCommandRunner } = await import("../dist/gitService/index.js");
    const real = new NodeGitCommandRunner();
    const runner = {
      run(args, cwd, options) {
        if (args.includes("check-ignore")) return Promise.resolve(answer);
        return real.run(args, cwd, options);
      },
    };
    const { GitService, NodeGitStateWatcher } = await import("../dist/gitService/index.js");
    const log = createReportLog();
    const service = new GitService({
      watcher: new NodeGitStateWatcher({ platform: "linux" }),
      runner,
      onObservation: (report) => log.onObservation(report),
    });
    t.after(() => service.close());
    await service.bindProject("project-a", fixture.main);
    const failed = await log.next("watch.failed", (report) => report.watch === "working-tree");
    assert.equal(failed.error.code, "EGITIGNORE");
  });
}

test("releasing the only project while its watch is still being established stops all Git and watch work", async (t) => {
  const layout = {};
  for (let index = 0; index < 40; index++) layout[`d${index}/e`] = null;
  const fixture = await repositoryWith(layout);
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const { GitService, NodeGitStateWatcher, NodeGitCommandRunner } = await import("../dist/gitService/index.js");
  const real = new NodeGitCommandRunner();
  const opened = [];
  const fs = {
    watch(path, options, listener) {
      opened.push(path);
      return nodeWatch(path, options, listener);
    },
    lstat: (path) => lstat(path),
    opendir: (path, options) => opendir(path, options),
  };
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const checkIgnores = [];
  const runner = {
    async run(args, cwd, options) {
      if (args.includes("check-ignore")) {
        checkIgnores.push({ aborted: () => options?.signal?.aborted === true });
        await gate;
        options?.signal?.throwIfAborted();
      }
      return real.run(args, cwd, options);
    },
  };
  const log = createReportLog();
  const service = new GitService({
    watcher: new NodeGitStateWatcher({ platform: "linux", treeWatch: { fs } }),
    runner,
    onObservation: (report) => log.onObservation(report),
  });
  t.after(() => service.close());
  await service.bindProject("project-a", fixture.main);
  await eventually(() => checkIgnores.length > 0, "discovery never asked Git about directories");
  assert.equal(service.releaseProject("project-a"), true);
  const watchesAtRelease = opened.length;
  const checksAtRelease = checkIgnores.length;
  assert.ok(checkIgnores.every((check) => check.aborted()), "the pending check-ignore was not cancelled");
  release();
  await settle(300);
  assert.equal(opened.length, watchesAtRelease, "a watch was opened after the project was released");
  assert.equal(checkIgnores.length, checksAtRelease, "Git ran for the released project");
});

test("check-ignore names quoted paths that are mapped back exactly", async () => {
  const { unquoteGitPath } = await import("../dist/gitService/observation.js");
  assert.equal(unquoteGitPath("plain"), "plain");
  assert.equal(unquoteGitPath('"q\\"x"'), 'q"x');
  assert.equal(unquoteGitPath('"nl\\nx"'), "nl\nx");
  assert.equal(unquoteGitPath('"back\\\\slash"'), "back\\slash");
  assert.equal(unquoteGitPath('"\\303\\251t\\303\\251"'), "été");
  assert.equal(unquoteGitPath('"emoji 🎉\\tx"'), "emoji 🎉\tx");
});

test("the Git-directory filter skips inert entries but keeps info and live refs", async () => {
  const { gitDirectoryWatchFilter } = await import("../dist/gitService/observation.js");
  assert.deepEqual(
    gitDirectoryWatchFilter(["objects", "logs", "hooks", "info", "refs", "refs/heads", "refs/tags", "refs/stash", "refs/remotes", "worktrees", "worktrees/a", "worktrees/a/logs", "lfs", "modules"]),
    ["info", "refs", "refs/heads", "refs/remotes", "worktrees", "worktrees/a"],
  );
});

test("ignore inputs in the Git directory are recognised", async () => {
  const { gitDirIgnoreInput, isIgnoreRuleChange } = await import("../dist/gitService/observation.js");
  assert.equal(gitDirIgnoreInput("info/exclude"), "rules");
  assert.equal(gitDirIgnoreInput("config"), "rules");
  assert.equal(gitDirIgnoreInput("index"), "tracking");
  assert.equal(gitDirIgnoreInput("worktrees/a/index"), "tracking");
  assert.equal(gitDirIgnoreInput("index.lock"), null);
  assert.equal(gitDirIgnoreInput("HEAD"), null);
  assert.equal(isIgnoreRuleChange("src/.gitignore"), true);
  assert.equal(isIgnoreRuleChange("src/a.txt"), false);
});
