## Why

Windows users have no supported way to run Terminay. The one known Windows
install today follows a five-page guide: install WSL and Ubuntu, a compiler,
nvm and the pinned Node, clone the repository, build it, and run the Linux
build through WSLg. The result is a Linux app drawn on the Windows desktop. Its
shells are Linux shells inside one WSL distribution, so it cannot open
PowerShell or Command Prompt, it shares the WSL VM's memory, and it never
updates itself. There is no `Terminay.exe` to download.

Much of the product is already written for Windows. Shell discovery finds
PowerShell 7, Windows PowerShell, Command Prompt, and one profile per WSL
distribution. `electron-builder.json5` already declares an NSIS x64 target. The
MCP control socket already uses a named pipe. None of it has ever run, because
no build or test runs on Windows. Several features are also switched off on
`win32`, and on Windows they would end terminals or lose behaviour silently:

- The session holder (ADR-0035) is disabled, so every update or restart ends
  every shell. That is the behaviour ADR-0035 exists to stop.
- Current-directory and foreground-process observation return nothing, so new
  splits do not inherit the directory, close protection cannot see a running
  command, and activity reads `limited`.
- The Git command stream (ADR-0052) listens on a Unix socket, which Node cannot
  serve on Windows. Without it, worktree capture never moves a terminal into
  the worktree it created.

The runtime matrix lists Windows Desktop as unsupported. This change makes it
supported, with feature parity and nothing shipped in a degraded state.

## What Changes

- **Supported matrix:** Terminay Desktop supports Windows 10 22H2 and Windows
  11 on x64, through a per-user NSIS installer,
  `Terminay-Windows-<version>-Setup.exe`. Windows on ARM and a standalone
  Terminay Server on Windows stay outside the matrix.
- **Release lanes:** the tag release and the rolling `main-latest` prerelease
  build the installer on a GitHub `windows-latest` runner, as they already
  build macOS on `macos-latest`. Nothing is built on Gitea. Before upload, a
  packaged Windows probe installs the candidate silently, starts it, waits for
  the session holder to be ready, and runs PowerShell, Command Prompt, and
  `node-pty` resize and exit checks through the packaged runtime. No Windows
  artifact is published if the probe fails.
- **Pull-request CI:** Gitea has no Windows runner, and this change does not
  add one. Every `win32` decision is therefore a pure function of an injected
  platform and host, and the Linux CI jobs unit-test it with Windows inputs.
  Windows-only regressions in native behaviour are caught on the `main` lane
  after merge, not before. That is a stated, accepted gap.
- **In-place updates:** Windows joins ADR-0027. The release publishes
  `latest.yml` (stable) and `beta.yml` (beta) beside the NSIS build, attached
  last. `electron-updater` installs a payload only after its SHA-512 matches.
- **Unsigned first release:** the installer and update payloads are not
  Authenticode-signed. Users see SmartScreen's "unknown publisher" prompt on
  first install. Update integrity rests on the SHA-512 in HTTPS metadata from
  GitHub releases. Code signing is a later change.
- **Session holder on Windows:** shells outlive the server on Windows as they
  do elsewhere. The holder listens on a named pipe whose name is derived from
  the data root and the user's SID. Both ends prove that they hold the holder
  credential before any session data moves, so a squatted pipe learns nothing.
  The holder runs from a generation-private copy of its runtime, so an update
  can replace the installation directory while shells are held.
- **Process observation on Windows:** the current directory and the foreground
  process come from the Win32 process table and from the current directory
  Windows records for each process, read through `koffi`. No shell is instrumented, and no
  helper process is spawned for each observation.
- **Git command reporting on Windows:** Trace2 events go to an owner-only
  per-server runtime directory. The server watches it, and parses and deletes
  each file as it appears. The ADR-0052 guarantees hold: nothing is kept, the
  input is untrusted, the user's own tracing wins, and Git works when Terminay
  is not listening.
- **MCP control pipe:** the fixed name `\\.\pipe\terminay-control` becomes a
  name derived from the user's SID and the data directory. Two users, or two
  data roots, on one machine can no longer collide or squat on each other's
  pipe.
- **Native modules:** every native file in the Windows payload (`pty.node`,
  `conpty.dll`, `OpenConsole.exe`, `koffi`) is checked as PE32+ x64 before
  publication.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `server-runtime-and-protocol`: the supported runtime matrix adds Windows
  Desktop x64. New requirements cover building and probing the Windows
  artifact before publication, and checking the architecture of its native
  files.
- `settings-shortcuts-and-desktop-integration`: update checks and verified
  in-place installation cover the Windows NSIS build and its `latest.yml` and
  `beta.yml` metadata.
- `persistent-terminal-sessions` (introduced by the active
  `terminals-survive-restart` change): the holder's local channel on Windows is
  a per-user, per-data-root named pipe with mutual credential proof. The holder
  keeps no file in the installation directory open.
- `terminal-workspace`: current-directory and foreground-process observation
  produce answers on Windows from the session's own process tree.
- `project-folders` (introduced by the active `linked-folders` change): the
  server learns which terminal created a worktree on Windows through a Trace2
  directory target that is deleted as it is read.
- `mcp-server`: on Windows the control endpoint is a named pipe whose name is
  per user and per data directory.
- `built-in-extensions`: release verification of built-in extensions covers
  Windows x64 Desktop.
- `pull-request-ci`: Windows platform logic is exercised on Linux CI with an
  injected platform. The packaged Windows probe runs on the `main` and tag
  lanes, and is stated as post-merge coverage.

## Impact

- **Sequencing:** this change modifies requirements that four active changes
  rewrite or introduce: `linux-glibc-floor`, `terminals-survive-restart`,
  `linked-folders` and `worktree-capture-survives-restart`. It archives after
  all four.
- **Code:**
  - `packages/server-core/src/sessionHolder/` (`paths.ts`, transport,
    credential handshake, runtime staging);
  - `apps/terminay-server/src/processCwd.ts` and `electron/processCwd.ts`
    (Windows process table and current directory);
  - `apps/terminay-server/src/gitCommandSocket.ts` and the worktree-capture
    host (directory target);
  - `apps/terminay-server/src/mcp/controlSocketPlacement.ts`;
  - `packages/server-core/src/terminalService/launchers.ts`;
  - `electron/main.ts` (single-instance, AppUserModelID, updater feed).
- **Build:**
  - `electron-builder.json5` (`win` and `nsis`, `publish`, `latest.yml`);
  - `package.json` (`build:win`);
  - `.github/workflows/trigger-release.yml` and `main-prerelease.yml` (a
    `windows-latest` matrix entry, the probe, metadata attachment);
  - new `scripts/probe-windows-desktop.ps1` and
    `scripts/check-windows-pe-architecture.mjs`.
- **Dependencies:** `koffi` (already in the lockfile as an optional extension
  dependency) becomes a direct server-core dependency on Windows only.
- **ADRs:**
  - a new ADR supersedes ADR-0077 to widen the distribution matrix and define
    the holder's Windows channel;
  - a new ADR supersedes ADR-0052 to allow a directory target on Windows;
  - ADR-0027's Windows consequence is realised without editing it.
- **Docs:** the README download section and `docs/product-overview.md` name
  Windows. The WSL-from-source guide is no longer needed for Windows users.
