# ADR Review Manifest

## ADR Review Completed

- Date: 2026-10-30
- Reviewer: Claude (for Mark Wylde)
- Change: native-windows-desktop

## In-Force ADR Context Reviewed

Depth of review: every ADR touching the distribution matrix, native modules,
the session holder, local sockets, Git tracing, updates, release lanes, or CI
was read in full and checked for supersession. The rest were screened by title.

- openspec/adr/0077-linux-artifacts-are-built-and-verified-at-a-declared-glibc-floor.md
  - Restates the holder topology and the matrix that excludes Windows.
    Superseded by 0083.
- openspec/adr/0069-git-command-reports-reach-the-server-across-restarts.md
  - Its Unix-socket Trace2 target cannot be served by Node on Windows.
    Superseded by 0084.
- openspec/adr/0054-a-local-socket-that-does-not-fit-the-data-directory-lives-in-an-owner-only-runtime-directory.md
  - Unix socket placement is unchanged. Windows pipes have no path limit and
    do not use it.
- openspec/adr/0055-exclusive-ownership-by-a-process-is-a-lock-the-kernel-holds.md
  - The `node:sqlite` exclusive lock maps to `LockFileEx` on Windows. It is
    unchanged, and is covered by the probe.
- openspec/adr/0027-desktop-updates-in-place-from-github-release-metadata.md
  - Its stated consequence, that Windows can join by publishing `latest.yml`,
    is realised here without editing it.
- openspec/adr/0026-extensions-may-ship-prebuilt-native-modules.md
  - Covers extensions only. A native module in the server needs 0085.
- openspec/adr/0033-pinned-node-runtime-baseline-on-npm-12-2.md
  - The holder runs on Electron-as-Node from the generation copy. No second
    Node runtime is added.
- openspec/adr/0036-five-minute-ci-budget-with-parallel-gates-and-eighteen-shards.md
  - No new pull-request job. The Windows unit tests run inside the existing
    Vitest gates.
- openspec/adr/0021-measure-background-cost-in-spawns-not-parent-syscalls.md and
  openspec/adr/0028-no-polling-without-owner-approval.md
  - They rule out spawning a process per observation and polling the trace
    directory.
- openspec/adr/0051-terminay-observes-agents-and-does-not-instrument-them.md
  - Rules out changing shell prompts (OSC 7 / OSC 9;9) for directory tracking.
- openspec/adr/0072-mcp-reach-is-the-authority-line-and-workspace-reach-controls-the-app.md
  - MCP authority is unchanged. Pipe naming only stops collisions and
    squatting.
- openspec/adr/0011-security-trust-boundary-model.md
  - The trust boundaries are unchanged. Mutual holder proof closes a Windows
    squatting gap.
- openspec/adr/0016-self-contained-server-archives-and-release-channels.md
  - Channels are unchanged. No Windows server archive is added.

## Repository-Level ADRs Created

- openspec/adr/0083-windows-x64-desktop-joins-the-matrix-and-holders-prove-themselves-both-ways.md
  - Supersedes 0077.
  - Adds Windows x64 Desktop to the matrix.
  - Puts the holder on a named pipe on Windows, with mutual HMAC proof on
    every platform and a generation-private runtime copy.
  - Requires that a Windows artifact runs on native Windows before it is
    published.
- openspec/adr/0084-on-windows-git-command-reports-arrive-as-files-that-are-deleted-as-they-are-read.md
  - Supersedes 0069.
  - On Windows, the Trace2 target is an owner-only directory whose files are
    watched, read, and deleted.
- openspec/adr/0085-the-server-reaches-win32-apis-through-koffi.md
  - Server-core may bind narrow Win32 APIs through `koffi`, which is loaded
    only on Windows.
- openspec/adr/0086-a-windows-pipe-admits-only-the-users-principals-and-a-peer-that-proves-the-credential.md
  - Supersedes 0083, after spike 1.1 showed libuv pipes serve remote clients.
  - A Windows pipe grants write access only to the user, SYSTEM and
    Administrators. Admission is by the holder proof or an MCP capability
    token, not by the client's machine.
  - One runtime copy per build, shared by that build's holders.
- openspec/adr/0087-terminay-keeps-powershells-process-directory-in-step-with-its-location-on-windows.md
  - The owner-approved exception to ADR-0051: an interactive PowerShell
    gets a prompt wrapper that syncs its process directory, after spike 1.4
    showed `Set-Location` leaves it unchanged.

## Notes

- The Windows-only regression gap before merge is stated in ADR-0086 §9 (as in
  ADR-0083 §9) and in
  the `pull-request-ci` delta. It is not hidden.
