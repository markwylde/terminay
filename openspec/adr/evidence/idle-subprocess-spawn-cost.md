# Idle subprocess spawn cost

Follow-up measurement to
[idle filesystem path-lookup cost](./idle-filesystem-path-lookup-cost.md). Same
machine and workspace: macOS 15 on Apple Silicon, 16 GB, Microsoft Defender for
Endpoint 101.26062.0012 with real-time protection on and MDM-managed; a pnpm
monorepo with **5 git worktrees** and **9,812 tracked files**. Claude Code
running in terminal tabs, so agent integration is active.

## What the previous change fixed

Main-process syscalls, 20-second idle sample before, 30-second sample after,
normalised per 30 seconds:

| syscall | before | after |
| --- | --- | --- |
| `getattrlist` | ~3,700 | 102 |
| `stat64` | ~1,000 | 38 |
| `pathconf` | ~590 | 18 |

Also zero in a 30-second idle window: re-reads of `terminal-settings.json` and
`remote-access-settings.json`, and rewrites of `workspace.v4.json`.

## What it did not fix

Endpoint-security CPU across 90 idle seconds, app open and untouched:

| process | CPU used | ≈ % of one core |
| --- | --- | --- |
| `wdavdaemon_unprivileged` | 32.2 s | 36% |
| `wdavdaemon` | 7.2 s | 8% |
| `wdavdaemon_enterprise` | 5.9 s | 7% |

~45 seconds of CPU per 90 seconds of wall clock, sustained, unchanged by the
previous fix.

The remaining ~4,451 main-process events in 30 idle seconds are dominated by one
thread repeating a `child_process.spawn` cycle — four pipe fds, `FIONREAD`, read
stdout to EOF, close — **259 times in 30 seconds (~8.6/s)**, with no idle second
in the sample.

Children identified by polling the process table alongside the trace:

| command | notes |
| --- | --- |
| `git status --porcelain=v1 -z --branch --untracked-files=all --ignored=no` | one per worktree; 0.28 s each |
| `git diff --numstat <base>...HEAD` | one per worktree |
| `git rev-list --count <base>..HEAD` | one per worktree |
| `lsof -p <12 pids> -F pan` | 8 MB output cap; PID list re-enumerated each time |
| `ps -axo pid=,ppid=,pgid=,stat=,comm=` | full process table |

`mdatp diagnostic real-time-protection-statistics` shows several hundred
short-lived PIDs each scanning exactly 9 files — one per spawn, each a fresh
binary for the Endpoint Security extension to authorise.

## Why the first measurement missed it

`fs_usage` on a PID does not follow that process's children. Tracing the main
process proved its own loops had stopped and could not, even in principle, show
that the work had moved one level down. An `exec` is more expensive to an
endpoint-security agent than the `stat` traffic it replaced.

**Count spawns from the process table:**

```sh
for i in $(seq 1 3000); do ps -Ao ppid=,pid=,command=; done \
  | grep -E 'git status|lsof|git diff|rev-list'
```

and cross-check the spawn rate in a parent trace via the two `FIONREAD` ioctls
each spawn produces:

```sh
grep -c 'CMD=0x8004667e' /tmp/terminay-idle.txt   # 2 per spawn
```

## Mechanisms

1. **Fan-out.** `gitDiffService.ts:294` maps over every worktree, four commands
   each. Five worktrees ≈ 20 spawns per refresh, triggered by a change in any
   one of them.
2. **Debounce shorter than its work.** `useFileExplorerController.ts:31` sets a
   120 ms trailing debounce; one `git status --untracked-files=all` takes
   0.28 s. A trailing debounce re-fires for every event spaced wider than its
   delay, which is the measured ~8 Hz.
3. **Ungated observation.** `ExtensionAgentRuntime` has no reference to the
   agent-integration setting, so disabling the feature clears `AgentService`'s
   maps while the runtime's topology timers keep spawning `lsof` and `ps`.
