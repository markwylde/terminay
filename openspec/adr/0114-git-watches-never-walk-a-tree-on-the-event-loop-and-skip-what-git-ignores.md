# ADR-0114: Git watches never walk a tree on the event loop, and skip what Git ignores

Status: accepted
Date: 2026-11-13

## Context

ADR-0022 made Git status change-driven: the server watches the Git directory and
every working tree, and damps refreshes with a ramp. It chose
`fs.watch({ recursive: true })` as the watch. On macOS and Windows that is a
kernel facility. On Linux, Node emulates it in JavaScript, with one inotify
watch per file and directory. On every change it re-walks the changed folder
with `readdirSync` on the main thread, and it has no exclusions.

A standalone Terminay Server on Linux stopped answering everyone for more than
two minutes, twice, while an agent built the project in a 70,000-entry
repository. Six inspector pauses of the 100%-CPU main thread all landed in
Node's `#watchFolder` → `readdirSync`. The ramp could not help because the cost
is paid before any event reaches the Git service. The server's event loop is
shared by remote transport, PTY fan-out, MCP and every other service, so a
watch that walks a tree inline is an outage, not a slow refresh. See
[`evidence/linux-recursive-watch-stall.md`](./evidence/linux-recursive-watch-stall.md).

## Decision

1. **No watch walks a directory tree synchronously on the server's event loop,
   on any platform.** Where the platform has no kernel recursive watch, the Git
   service builds one from one-level watches. It discovers directories with
   asynchronous reads in bounded steps that yield between them, and it takes up
   bursts of new directories together.
2. **A built-up working-tree watch skips what Git ignores, and Git decides.** Exclusion
   asks Git (`git check-ignore`) when a watch opens, when new directories
   appear, and when ignore rules change. It never runs on a timer. `.git`
   directories and the roots of other registered worktrees are excluded and
   watched on their own.
3. **The Git-directory watch skips what observation already calls inert**:
   object storage, reflogs, hooks, tag and stash refs.
4. **Every built-up watch has a directory ceiling.** Exceeding it, or exhausting
   the host's watch capacity, fails the watch into the existing on-demand
   measurement path. It never falls back to polling (ADR-0022, ADR-0028).
5. **Native recursive watches stay where the platform implements them in the
   kernel** (macOS FSEvents, Windows `ReadDirectoryChangesW`).

## Consequences

- On Linux, build output, `node_modules` installs and other ignored churn cost
  no watch, no event and no Git refresh. On macOS and Windows the kernel still
  reports that churn, and the existing ramp damps it as before.
- On Linux, every worktree root has its own watch, even when it is nested in
  another, because nesting usually sits inside an ignored directory.
- A Linux working tree with more non-ignored directories than the ceiling loses
  live Git status and is measured on demand. Raising the ceiling needs
  measurement, not a guess.
- Any future watcher in the server (file explorer, agent discovery, extensions)
  is held to Decision 1. Node's recursive `fs.watch` is not acceptable on Linux
  for a tree we do not control.
