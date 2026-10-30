# Git Trace2 directory target on Windows

Spike 1.2 of `native-windows-desktop`, for ADR-0079. Script:
`scripts/windows-spikes/git-trace2-directory.mjs`.

- Date: 2026-10-30
- Runner: GitHub `windows-latest`, run 41101066460 of
  `markwylde/terminay-windows-tests` (job `git-trace2-directory`)
- Git: `git version 2.56.0.windows.2`
- Node: v24.15.0

## Method

A directory was named as `GIT_TRACE2_EVENT`, with `GIT_TRACE2_EVENT_BRIEF=1`,
`GIT_TRACE2_EVENT_NESTING=1`, and `GIT_TRACE2_PARENT_SID` set to a 32-character
token. `fs.watch` recorded every event in the directory while
`git worktree add -q -b spike-wt <path>` ran, and each file was parsed after
Git exited.

## Results

- **One file per Git process.** The command produced three files: the
  `worktree add` process and two child Git processes it spawned
  (`git branch …`, and the checkout). Names have the form
  `<UTC timestamp>-H<host hash>-P<pid hex>`, for example
  `20261030T174348.469267Z-Ha7c530b9-P0000179c`. No name contains a path
  separator or a leading dot.
- **Files grow while the process runs.** The watcher saw a `rename` when each
  file was created (238–487 bytes, the `version` and `start` lines) and
  `change` events as it grew. The `worktree add` file grew from 448 to 2,930
  bytes, and its last write landed 4 ms before the process's exit was observed.
  A reader must therefore read incrementally and must not treat creation as
  completion.
- **`atexit` is always last.** Every file ended `… exit`, `atexit`.
- **The parent session id is carried.** Every `sid` begins with the token, and
  each child extends its parent's id with `/`
  (`<token>/<parent>/<child>`), so the existing "first segment is the
  terminal's token" rule holds unchanged.
- **The `start` event carries argv.** For the parent:
  `["git.exe","worktree","add","-q","-b","spike-wt","C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\tgt-ZdK1e5\\wt"]`.
  `argv[0]` is `git.exe`, and the target is a Windows path.
- **Size.** 2.5–5.4 KB per process, in line with ADR-0052's 4.5 KB per command.
- **Timing.** The whole command took 158 ms, and the first file appeared 30 ms
  in.

## Consequences for the design

Decision 7 holds as designed:

- read incrementally on watch events;
- delete after `exit` and `atexit`;
- bound each file at 64 KiB, about 12 times the largest file seen.

Worktree-capture parsing must accept a Windows path as the `worktree add`
target, and take its final component with Windows separators.
