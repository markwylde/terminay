## Context

Terminay Desktop is an Electron host around an embedded Terminay Server. The
server runs its PTYs in a detached session holder (ADR-0077, restating
ADR-0035). It reports Git commands through Trace2 (ADR-0069) and exposes MCP on
a local socket (ADR-0054). Its in-force distribution matrix (ADR-0077 §6)
excludes Windows.

Some Windows code exists, but none of it has ever been executed:

- `packages/server-core/src/shellProfiles/` discovers PowerShell 7, Windows
  PowerShell, Command Prompt, and WSL distributions, through an injected host,
  and the spec states the Windows order.
- `terminalService/launchers.ts` builds PowerShell launch arguments.
- `electron-builder.json5` has a `win` NSIS x64 target.
- `controlSocketPlacement.ts` returns a fixed `\\.\pipe\terminay-control`.

Other features are switched off on `win32`:

- `sessionHolderEnabled()` returns false, so terminals die with the server.
- `resolveTerminalForegroundProcess` and `childProcessIds` and
  `resolveProcessCwd` return nothing. They shell out to `ps`, `pgrep`,
  `readlink` and `lsof`.
- `gitCommandSocketHostOptions` falls back to a per-run path, which on Windows
  is not a Unix socket at all, because libuv serves only named pipes.

Releases are built only on the GitHub mirror (`trigger-release.yml` and
`main-prerelease.yml`), whose matrix holds `macos-latest` and `ubuntu-latest`
(through the floor image). Pull-request CI is Gitea, with Linux runners and one
macOS runner. The owner has decided:

- releases only on GitHub, with no Windows runner on Gitea;
- the first release unsigned;
- in-place updates included;
- Desktop only;
- x64 only;
- no degraded beta: holder, process observation and Git capture all work at
  launch.

## Goals / Non-Goals

**Goals:**

- A `Terminay-Windows-<version>-Setup.exe` from every tag and from
  `main-latest`. It installs per user with no prompts beyond SmartScreen, and
  starts terminals with no WSL, Node, or Git present.
- Every specified behaviour works on Windows:
  - shells survive restart and update;
  - splits inherit the directory;
  - close protection sees running commands;
  - worktree capture moves the terminal;
  - MCP reaches only the user's own server;
  - updates install in place.
- Windows-specific logic is unit-tested on Linux pull-request CI. Native
  behaviour is proven on the exact installer before it is published.

**Non-Goals:**

- Authenticode signing, and SmartScreen reputation. That is a later change.
- Windows on ARM, and a standalone Terminay Server or `daemon` CLI on Windows.
- A Windows runner in Gitea pull-request CI, and the Docker E2E suite on
  Windows.
- Seeing inside WSL:
  - the current directory and foreground process of a WSL terminal are
    `limited`;
  - Git run by Linux inside WSL does not report.

  The distribution's processes live in a VM that Windows' process table does
  not show.
- Projects whose root is a `\\wsl$\` path. They are not refused, but they are
  not qualified either.

## Decisions

### 1. Build and verify only on GitHub's `windows-latest`, after merge

A third matrix entry (`os: windows-latest`, `label: Windows`,
`script: npm run build:win`) joins both release workflows. It publishes the
installer, its `.blockmap`, and the update metadata (decision 6). Before
anything is uploaded, `scripts/probe-windows-desktop.ps1` runs the spec's probe
against the installer it just built:

1. a silent per-user install (`/S`) into a temporary profile directory;
2. launch with `TERMINAY_DATA_DIR` pointing at a scratch root and a probe flag
   that has the embedded server print readiness;
3. PowerShell and Command Prompt: input, resize, output and exit;
4. a server restart with a held terminal;
5. uninstall.

`scripts/check-windows-pe-architecture.mjs` reads the `IMAGE_FILE_HEADER.Machine`
of every PE file and requires `0x8664`.

*Alternatives:*

- A self-hosted Windows Gitea runner. The owner declined it.
- Cross-building from Linux with Wine. `node-pty` and ConPTY need MSVC, and a
  build that is never executed proves nothing (`built-in-extensions` already
  forbids emulated evidence).

*Boundary:* CI provider portability (ADR-0036). Pull requests stay
Gitea-gated. Native Windows proof moves after merge, and this is stated in
`pull-request-ci`.

### 2. Make every Windows branch a pure function of an injected host

Shell discovery already does this. The same pattern extends to:

- holder enablement and pipe naming;
- control-pipe naming;
- process-table parsing and foreground selection;
- Trace2 target selection;
- `canInstallInPlace` (which today returns false for `win32`).

Each takes `{ platform, userSid, ... }` and touches no `process.platform`.
Linux Vitest suites cover the Windows cases. That is the only pre-merge
Windows signal, so it is mandatory rather than best effort.

### 3. A per-user one-click NSIS installer

The NSIS options change to `oneClick: true`, `perMachine: false` and
`allowToChangeInstallationDirectory: false`. The app installs to
`%LOCALAPPDATA%\Programs\Terminay`, which the user owns. Updates then run `/S`
with no UAC prompt, and always into the directory they replace. The data root
stays Electron's `userData` (`%APPDATA%\Terminay`). That directory inherits a
DACL that grants only the user, SYSTEM, and Administrators, and the server
checks this on start.

*Alternatives:*

- An assisted installer whose directory the user can change. It allows
  `Program Files`, after which every update needs elevation. That breaks
  "Restart to update" and the spec's "without elevation".
- MSIX. It needs signing, which is out of scope.

### 4. Session holder on a mutually authenticated named pipe, run from a generation copy

The pipe is named
`\\.\pipe\terminay-holder-<sha256(userSid + "\0" + realpath(dataRoot))[:24]>-<generation>`.
libuv's `uv_pipe_bind` creates it with `FILE_FLAG_FIRST_PIPE_INSTANCE`, so an
existing name fails the bind with `EADDRINUSE`. It also uses the default
security descriptor, under which only the creator, SYSTEM, and Administrators
have write access. Spike 1.1 confirmed both. It also showed that libuv does not
set `PIPE_REJECT_REMOTE_CLIENTS`, and that Node gives the server no pipe handle
to ask who connected. So a pipe cannot tell a client on this machine from one
reaching it over the network as the same principal. Connecting admits
neither: the holder answers only a peer that completes the proof below, and the
control pipe serves only a capability token (ADR-0086).

The server, not the holder, closes `<dataRoot>\session-holder` to all but the
user, SYSTEM and Administrators before it launches a holder. It passes the SID
in `TERMINAY_SESSION_HOLDER_USER_SID`, so the holder loads no Win32 bindings.

The holder protocol gains a version with mutual proof:

1. each side sends a random 32-byte nonce;
2. each side replies with `HMAC-SHA256(credential, "holder"|"server" ||
   own nonce || peer nonce)`;
3. no session frame is accepted or sent until both proofs verify.

The credential never crosses the wire. Squatting on a pipe name is a real
threat on Windows, because the pipe namespace is machine-wide where Unix
sockets live in owner-only directories. The proof runs on every platform, so
there is a single protocol. Servers keep speaking the previous holder version
for Unix holders that are already live, as ADR-0035 requires.

An installed `Terminay.exe` cannot be replaced while a process has it mapped.
electron-builder's NSIS script also finds and kills running processes by name.
So the first holder launch of a build copies the minimal
`ELECTRON_RUN_AS_NODE` runtime into `<dataRoot>\holder-runtime\<sha256(buildId)[:16]>\`,
which every holder of that build shares:

- the executable, renamed `terminay-session-holder.exe`;
- its DLLs, `icudtl.dat`, and the V8 snapshot files;
- the holder bundle and the unpacked `node-pty` (`pty.node`, `conpty.dll`,
  `OpenConsole.exe`).

The copy is made under a temporary name and renamed into place once it is
complete. Holders run from it. A later launch removes every other build's copy,
deleting the executable first. Windows refuses to delete a running image, so a
copy whose executable will not go is still in use and is kept whole.

The holder is spawned with `detached: true` and `windowsHide: true`, outside
any kill-on-close job object.

*Alternatives:*

- Hard links into the installation. A mapped image still blocks replacing it,
  so this saves disk but not the update.
- Shipping a separate `node.exe`. That would add a second pinned runtime to
  qualify (ADR-0033).
- Leaving the holder off on Windows. The owner rejected degraded behaviour.

*Boundary:* holder–server trust (ADR-0035 §3, persistent-terminal-sessions).
Process ancestry is unchanged: shells are children of the holder.

### 5. Windows process observation through `koffi`

`packages/server-core/src/processObservation/windows.ts` binds a small set of
kernel32 and ntdll functions with `koffi`:

- `CreateToolhelp32Snapshot` with `Process32FirstW` and `Process32NextW`,
  which give pid, parent pid and executable;
- `OpenProcess` with `PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ`;
- `GetProcessTimes`;
- `NtQueryInformationProcess(ProcessBasicInformation)`;
- `ReadProcessMemory`, to read `PEB → ProcessParameters → CurrentDirectory.DosPath`.

All of these work against the user's own processes without elevation. WoW64
(32-bit) targets are read through `ProcessWow64Information` and the 32-bit PEB
layout. A target that cannot be opened reports `limited`.

Foreground selection takes one snapshot. It walks down from the shell pid,
skipping `conhost.exe` and `OpenConsole.exe`, and where siblings compete it
takes the most recently created child at each level. It reuses
`selectForegroundProcessFromTable` with `pgid = pid`. A WSL profile's root is
`wsl.exe`, and observation reports `limited` for it without walking.

`koffi` is already in the lockfile, prebuilt for win32-x64 N-API, and loads
with install scripts disabled. It becomes a direct `optionalDependency` of
server-core, which loads it only on `win32`. Desktop's
`electron/processCwd.ts` delegates to the same module rather than duplicating
it.

PowerShell does not move its process directory on `Set-Location` (spike 1.4).
So an interactive PowerShell that Terminay starts on Windows gets
`-NoExit -EncodedCommand <hook>`. After the profiles load, the hook wraps the
prompt so that each prompt sets `[Environment]::CurrentDirectory` to a
filesystem location, then draws as before. The owner approved this as an
exception to ADR-0051 (ADR-0087). The PEB read then needs no per-shell
handling.

*Alternatives:*

- `wmic`, PowerShell `Get-CimInstance`, or `tasklist` for each observation.
  They spawn a process every time, cost 100–600 ms each, and would breach
  ADR-0021's spawn budget.
- Shell integration through OSC 9;9 or OSC 7. It changes what the user's
  prompt prints, needs a hook for every shell rather than PowerShell alone,
  and cannot see the foreground process.
- A bespoke N-API addon. That is a new native artifact to build and qualify,
  where `koffi` is already qualified.

*Boundary:* the server is the only process that inspects terminal processes
(terminal-workspace). Nothing reaches the renderer except the derived
directory or command name.

### 6. Windows updates through electron-updater's NSIS updater

`canInstallInPlace` returns true for a packaged `win32` build whose executable
is under `%LOCALAPPDATA%\Programs\Terminay`. The release metadata is:

- stable: `latest.yml`;
- beta: `beta.yml`, renamed into place last, exactly as the `*-mac.yml` and
  `*-linux.yml` files are.

`publisherName` is left unset, so electron-updater skips Authenticode
verification. Integrity rests on the SHA-512 in metadata fetched over HTTPS
from GitHub releases. That is the same guarantee as the Linux AppImage, and
weaker than macOS. Restart to update quits through the normal path. The holder
is not a child that NSIS kills (decision 4), so held terminals survive.

*Boundary:* updates are device-owned and the renderer never names a payload
(ADR-0027 §4–5). Both are unchanged.

### 7. Trace2 writes to an owner-only directory on Windows

On `win32`, `GIT_TRACE2_EVENT` names `<dataRoot>\run\git-trace\`. Git for
Windows writes one file per Git process into a directory target. The server
watches the directory with `fs.watch`, which uses ReadDirectoryChangesW, and
does not poll (ADR-0028). It reads each file incrementally as it grows,
applies the existing line bound and a per-file bound of 64 KiB, and deletes the
file once the process's `exit` or `atexit` event has been read or the bound is
hit. On start the server deletes every file it finds. It does not attribute
them, because their tokens may be from before the restart, and ADR-0069
already handles a session that ended.

The token derivation, recognition, consumer registry and untrusted-input rules
are the same as in ADR-0069. The directory is created with an explicit,
protected DACL that names only the user, SYSTEM, and Administrators, set
through `koffi`'s `SetNamedSecurityInfoW`, and that DACL is verified on every
start.

*Alternatives:*

- A small AF_UNIX listener through `koffi`. Windows 10 supports AF_UNIX and
  Git for Windows may well target it, but Node's `net` cannot accept on it.
  This would mean a hand-rolled socket loop in FFI.
- Forgoing capture on Windows. The owner rejected degraded behaviour.

*Boundary:* the Git stream is untrusted, local, and never stored (ADR-0069
§6–7, §11). A file that exists for the lifetime of one Git process is a
transport buffer, not storage. That distinction is recorded in a superseding
ADR rather than assumed.

### 8. A per-user, per-data-root MCP control pipe

`CONTROL_SOCKET_WINDOWS_PIPE` becomes
`\\.\pipe\terminay-control-<sha256(userSid + "\0" + realpath(dataDir))[:24]>`.
It gets the same first-instance and remote-rejection treatment as decision 4.
Terminals receive it through the existing environment variable. A taken name
goes through the existing "endpoint cannot be placed" recovery path. The
user's SID comes from `koffi`, through `OpenProcessToken` and
`GetTokenInformation(TokenUser)`. It is not taken from `%USERNAME%`, which can
be spoofed.

*Boundary:* MCP authority (ADR-0072). Capability tokens still authenticate
callers. The pipe's name and ACL only stop collisions and squatting.

## Risks / Trade-offs

- **Windows regressions merge before they are seen.** Mitigation: decision 2's
  injected-host tests, and a `main` lane failure keeps beta clients on the
  last good build.
- **SmartScreen warns every new user, and some corporate machines block
  unsigned executables outright.** Mitigation: the README says so. Signing is
  the next change.
- **Unsigned updates mean anyone who can publish to the GitHub release can
  push code to Windows users.** This is the same exposure as Linux today.
  Mitigation: the release-publishing controls of ADR-0027 and ADR-0016.
- **A holder runtime copy costs about 150–200 MB on disk for each live
  generation, and adds a copy of a second or so on the first launch after an
  update.** Mitigation: only generations with live holders keep a copy, so
  normally one or two copies exist.
- **Defender may scan or quarantine the copied, unsigned
  `terminay-session-holder.exe`.** Mitigation: the probe runs with Defender's
  default settings on the runner. A holder that is blocked reports its reason
  through the launch-failed diagnostic.
- **`PEB` layout reading is undocumented API.** Mitigation: the layout has been
  stable since Windows XP for these fields, and it is the same technique
  Process Explorer and other tools use. A read failure reports `limited` and
  never crashes.
- **Git for Windows' directory-target file naming or flushing may differ from
  the documentation.** Mitigation: the spike in task 1 measures it against the
  pinned Git for Windows version on the runner before decision 7 is built.
- **Git older than 2.37 or a non-Git-for-Windows `git.exe` may not support a
  directory target.** It then sends nothing, which is the existing
  "unreachable target" case.

## Migration Plan

There is no existing Windows install base, so there is nothing to migrate.

1. Land the injected-host refactors and Linux tests (decision 2).
2. Land the holder protocol version with mutual proof on every platform.
   Unix servers keep the previous version for live holders.
3. Land the Windows implementations behind `win32`.
4. Add the Windows matrix entry to `main-prerelease.yml` first. Gate on the
   probe until `main-latest` has published a Windows build that installs,
   updates to the next `main` build, and keeps terminals.
5. Add it to `trigger-release.yml` and cut a tag.

Rollback: remove the Windows matrix entries, and the next release publishes no
Windows assets. Installed clients find no newer `latest.yml` or `beta.yml` and
stay on their version.

## Open Questions

- **ADRs to supersede:**
  - ADR-0077 §6 (the distribution matrix excludes Windows) is revisited. The
    holder's local channel (ADR-0035 §3, restated in 0077) also gains a
    Windows form and a mutual proof.
  - ADR-0069 §1 and §6 (a Unix socket target, and nothing stored) are
    revisited for a short-lived directory target on Windows.
  - Both supersessions are recorded by the adr step.
- **A new native dependency in the server.** ADR-0026 covers prebuilt native
  modules in extensions only. `koffi` in server-core needs its own record.
- **Spike results that could change a decision:**
  - whether libuv rejects remote pipe clients (decision 4, 8);
  - Git for Windows' directory-target behaviour (decision 7);
  - the minimal file set `ELECTRON_RUN_AS_NODE` needs on Windows (decision 4).

  None of them reopens the owner's scope decisions. A negative result changes
  the mechanism, not the contract.
