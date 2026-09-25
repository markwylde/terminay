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
    watch(path, options) {
      const entry = { path: resolve(path), options, closed: false };
      entries.push(entry);
      return {
        close() {
          entry.closed = true;
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
