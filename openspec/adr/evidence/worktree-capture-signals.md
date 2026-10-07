# Worktree capture signals

Date: 2026-10-08
For: `openspec/changes/linked-folders` task 1.1, and ADR-0051

## Question

When something in a Terminay terminal creates a Git worktree, can the server
tell which terminal it was, without depending on which agent, if any, is running
there?

Four ways were looked at. The scripts for the two that were measured are in
[`worktree-capture-spike/`](./worktree-capture-spike/).

## Summary

| Approach | macOS, tiny repo | macOS, 3,644-file repo | Linux, tiny repo | Depends on the agent | Needs privilege |
| --- | --- | --- | --- | --- | --- |
| Agent's reported directory | works for Claude Code's worktree tool only | same | not measured | Yes | No |
| Look up the `git worktree add` process when the registry watch fires | 0 of 20 | 10 of 10 | 19 of 20 | No | No |
| Git reports its own commands to a server socket named in the terminal's environment | 20 of 20 | not measured | 20 of 20 | No | No |
| Operating-system file-access stream per terminal | not measured | not measured | not measured | No | Yes |

## 1. The agent's reported directory

Measured on one live Claude Code 2.1.294 session in a Terminay Desktop terminal
on macOS, started in the project root.

- After it created a worktree with its own worktree tool,
  `~/.claude/sessions/<pid>.json` reported the worktree as `cwd`, and
  `lsof -a -d cwd -p <claude pid>` reported the same path. The detection
  library's Claude provider emits `session:update` when that `cwd` changes.
- After a plain `cd` from its shell tool, the `claude` process's directory did
  not move, and the session file had not been rewritten.
- By reading `@markwylde/all-your-agents` 1.4.4: the Grok provider reports a
  changed directory; the Codex and Oh My Pi providers do not.

This approach works for one agent using one tool. It was rejected, and ADR-0051
records why.

Two readings look like signals and are not: `get_terminal_status` and
`list_terminals` over MCP return the terminal's launch directory, and the
terminal's shell process stays in the project root while the agent moves.

## 2. Looking up the creating process when the registry watch fires

`worktree-race.mjs` keeps a long-lived shell as a stand-in for a terminal,
watches the repository's common directory recursively as `GitService` does, and
types `git worktree add` into the shell. On the first registry event it runs one
`ps`, looks for a `git … worktree add` process, and walks its parents to the
shell.

| Platform | Repository | `git worktree add` took | Watch event arrived after | `ps` took | Found, and reached the shell |
| --- | --- | --- | --- | --- | --- |
| macOS, Node 24.14 | 1 file | 45 ms median | 34 ms median, 80 ms max | 34 ms | 0 of 20 |
| macOS, Node 24.14 | clone of this repository, 3,644 files | 335 ms median | 32 ms median | 32 ms | 10 of 10 |
| Linux container, Node 22.23, Git 2.39.5 | 1 file | 19 ms median | 8 ms median | 7 ms | 19 of 20 |

On macOS the watch event plus the `ps` take about 65 ms together. Git has to
still be running then, which it is for a real repository and is not for a tiny
one. On Linux both steps are fast enough to win most of the time even on a tiny
repository. It is a race everywhere, and the outcome depends on repository size.

## 3. Git reporting its own commands

Git has a tracing facility, Trace2, that writes one JSON line per event to a
target named in `GIT_TRACE2_EVENT`, which may be a Unix socket. `trace2.mjs`
listens on a socket and sets, in the stand-in terminal's environment only:

```
GIT_TRACE2_EVENT=af_unix:stream:<socket>
GIT_TRACE2_EVENT_BRIEF=1
GIT_TRACE2_EVENT_NESTING=1
GIT_TRACE2_PARENT_SID=terminay-session-42
```

Every Git process started anywhere beneath that shell inherits the variables.
Each one sends a `start` event carrying its full argument list, and its session
id begins with the parent id from the environment, which identifies the
terminal. The command was run through an inner `sh -c`, the way an agent's tool
call runs it.

| Platform | Git | `worktree add` seen | Carried the terminal's id | Seen before Git exited |
| --- | --- | --- | --- | --- |
| macOS | 2.54.0 (Apple Git-157) | 20 of 20 | 20 of 20 | 20 of 20 |
| Linux container | 2.39.5 | 20 of 20 | 20 of 20 | 20 of 20 |

Cost, measured on `git status --porcelain`, 50 runs each way:

| Platform | Without tracing | With tracing | Sent per command |
| --- | --- | --- | --- |
| macOS | 8.70 ms | 9.18 ms | 4.4 KB in 23 lines |
| Linux container | 0.62 ms | 0.71 ms | 4.6 KB in 25 lines |

With the socket removed, Git ran normally and printed nothing to standard error.

Limits found or known:

- A Unix socket path is capped at about 104 bytes. The first run failed with
  `EINVAL` on a long scratch path. The socket has to live at a short path.
- This is a race-free answer only where the Git process can reach the socket. A
  sandbox that blocks Unix socket connections would silence it. That was not
  tested against any agent's sandbox.
- A user who has set `GIT_TRACE2_EVENT` themselves must keep their own target.
- Not measured on the larger repository; the event is sent at start-up, before
  any checkout, so repository size should not matter.

### Reachability from inside agents

One `git status` was run under each agent on macOS, non-interactively, with the
variables set and a listener on the socket. The scripts are `listener.mjs`,
`run-agent.sh`, and `run-codex-sandbox.sh`.

| Agent | How Git was run | Event arrived with the terminal's id |
| --- | --- | --- |
| Claude Code 2.1.294 | its shell tool, `claude -p`, sandbox not enabled | Yes |
| Oh My Pi 18.4.4 | its shell tool, `omp -p --auto-approve` | Yes |
| Codex CLI 0.160.0 | Codex's own start-up Git calls, outside its sandbox | Yes |
| Codex CLI 0.160.0 | `codex sandbox git status`, inside its default sandbox | No. Git ran and printed its output; nothing reached the socket |
| Grok 1.0.41 | not run: the CLI was not signed in | Unknown |

The Codex model itself could not be run, because the account was out of quota,
so its sandbox was exercised directly with `codex sandbox`. Codex's sandbox
blocks the connection, and Git carries on without reporting, as it does for any
unreachable target. Whether a `git worktree add` that Codex runs after the user
approves it executes inside or outside that sandbox was not tested.

The stream also showed each agent's own background Git calls, which carry
option arguments before the subcommand, for example
`git -c core.fsmonitor= -c … status`. A consumer has to find the subcommand
after the options, not at a fixed position.

## 4. An operating-system file-access stream per terminal

Tried on macOS as an ordinary user: `fs_usage` answered "must be run as root",
`dtrace` answered "DTrace requires additional privileges" with System Integrity
Protection on, and `eslogger` answered "need to be superuser". Not tried on
Linux. Neither platform offers one to an unprivileged process.
The watches Terminay already uses, FSEvents on macOS and inotify on Linux,
report that a path changed and never which process changed it. The facilities
that do report the process need privilege: on macOS, Endpoint Security needs an
entitlement and root, and `fs_usage` and DTrace need root and are restricted by
System Integrity Protection; on Linux, fanotify with process information and
eBPF need `CAP_SYS_ADMIN`. Tracing every process of a terminal with `ptrace`
needs no privilege on Linux, slows everything it traces, and has no macOS
equivalent.

## What it means for the design

- Approach 3 is the only one that is both independent of the agent and
  deterministic. It changes the environment of Terminay's terminals and makes
  every Git command in them send about 4.5 KB to the local server, so it needs
  the owner's approval before it is adopted.
- Approach 2 needs nothing new in the terminal and no approval, and it misses
  small repositories, mostly on macOS.
- Either can back up the other: a `start` event that never arrives falls back to
  the process lookup.

## Not settled

- Whether the Unix socket is reachable from inside each agent's sandbox.
- Approach 2 on a mid-sized repository, where the margin on macOS is thinnest.
