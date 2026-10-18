import { execFile } from "node:child_process";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function git(args, cwd) {
  return execFileAsync("git", args, { cwd });
}

/** A repository with a committed file, at a canonical (realpath) location. */
export async function createRepository(prefix = "terminay-git-observe-") {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  const main = join(root, "main");
  await execFileAsync("git", ["init", "-b", "main", main]);
  await git(["config", "user.email", "test@example.invalid"], main);
  await git(["config", "user.name", "Terminay Test"], main);
  await writeFile(join(main, "a.txt"), "a\n");
  await git(["add", "."], main);
  await git(["commit", "-m", "first"], main);
  return { root, main, gitDir: join(main, ".git") };
}

/**
 * Stands in for the host filesystem watch. Tests drive events by path, and can
 * see exactly which watches are open, so "nothing is watched after close" is
 * an assertion rather than a hope.
 */
export function createFakeWatcher() {
  const entries = [];
  const waiters = new Set();
  const notify = () => {
    for (const waiter of [...waiters])
      if (waiter.ready()) {
        waiters.delete(waiter);
        waiter.resolve();
      }
  };
  const until = (ready) =>
    new Promise((resolvePromise) => {
      const waiter = { ready, resolve: resolvePromise };
      waiters.add(waiter);
      notify();
    });
  return {
    entries,
    open() {
      return entries.filter((entry) => !entry.closed);
    },
    openPaths() {
      return this.open().map((entry) => entry.path).sort();
    },
    isWatching(path) {
      return this.open().some((entry) => entry.path === resolve(path));
    },
    /** Resolves once a watch on `path` is open: the service opening it is the event. */
    opened(path) {
      return until(() => this.isWatching(path));
    },
    /** Resolves once no watch on `path` is open. */
    closed(path) {
      return until(() => !this.isWatching(path));
    },
    watch(path, options) {
      const entry = { path: resolve(path), options, closed: false };
      entries.push(entry);
      // The service finishes what it does around opening a watch (such as
      // recording the Git directory) in the same turn, so waiters run after it.
      queueMicrotask(notify);
      return {
        close() {
          entry.closed = true;
          queueMicrotask(notify);
        },
      };
    },
    emit(path, relativePath) {
      const targets = this.open().filter((entry) => entry.path === resolve(path));
      if (targets.length === 0) throw new Error(`no open watch on ${path}`);
      for (const entry of targets) entry.options.onChange(relativePath);
    },
    fail(path, error = Object.assign(new Error("watch limit"), { code: "ENOSPC" })) {
      for (const entry of this.open().filter((candidate) => candidate.path === resolve(path)))
        entry.options.onError(error);
    },
  };
}

/** Counts every Git child process, with its working directory. */
export function createCountingRunner(Runner) {
  const inner = new Runner();
  const calls = [];
  return {
    calls,
    against(path) {
      return calls.filter((call) => call.cwd === path).length;
    },
    /** Per-worktree measurement starts with `status`; repository-level
     *  commands (`worktree list`, the default-branch probe) do not. */
    statusAgainst(path) {
      return calls.filter((call) => call.cwd === path && call.args.includes("status")).length;
    },
    run(args, cwd, options) {
      calls.push({ args: [...args], cwd });
      return inner.run(args, cwd, options);
    },
  };
}

/**
 * Collects the service's observation reports and resolves a wait on the
 * report that ends it, so a test waits on what the service did rather than on
 * a clock. `until` also accepts a report that already arrived.
 */
export function createReportLog() {
  const reports = [];
  const waiters = new Set();
  return {
    reports,
    onObservation(report) {
      reports.push(report);
      for (const waiter of [...waiters])
        if (waiter.ready(reports)) {
          waiters.delete(waiter);
          waiter.resolve(report);
        }
    },
    until(ready) {
      if (ready(reports)) return Promise.resolve(reports.at(-1));
      return new Promise((resolvePromise) => waiters.add({ ready, resolve: resolvePromise }));
    },
    /** The next report of `kind` (and matching `match`) to arrive from now on. */
    next(kind, match = () => true) {
      const from = reports.length;
      return new Promise((resolvePromise) =>
        waiters.add({
          ready: (all) => all.slice(from).some((report) => report.kind === kind && match(report)),
          resolve: () => resolvePromise(reports.slice(from).find((report) => report.kind === kind && match(report))),
        }),
      );
    },
  };
}

/**
 * The Git service's timers, held by the test. Nothing fires until the test
 * fires it, so "nothing is scheduled" is an assertion on `pending()`.
 */
export function createManualTimers() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, delayMs) {
      const id = ++nextId;
      timers.set(id, { callback, at: now + delayMs, delayMs });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    /** Delays of the timers armed and not yet fired or cleared. */
    pending() {
      return [...timers.values()].map((timer) => timer.delayMs);
    },
    /** Move the clock forward, firing every timer that falls due, in order. */
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort(([, a], [, b]) => a.at - b.at)[0];
        if (due === undefined) break;
        const [id, timer] = due;
        timers.delete(id);
        now = timer.at;
        timer.callback();
      }
      now = until;
    },
  };
}

export async function eventually(read, message = "condition did not become true", timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await read()) return;
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export function settle(ms = 150) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
