## 1. Spikes on a native Windows runner

- [x] 1.1 On a GitHub `windows-latest` workflow_dispatch job, bind a Node `net` pipe server twice to one name and connect from another machine name. Record whether libuv uses `FILE_FLAG_FIRST_PIPE_INSTANCE`, the pipe's default DACL (`Get-Acl`), and whether remote clients are rejected, in `openspec/adr/evidence/windows-named-pipe-spike.md`. Verified by the evidence file naming the libuv version and each observed result.
- [x] 1.2 On the same runner, run `git worktree add` with `GIT_TRACE2_EVENT=<dir>` and the brief/nesting variables. Record the file naming, flush timing, whether `exit` is the last line, and the Git for Windows version, in `openspec/adr/evidence/git-trace2-directory-target-windows.md`. Verified by the evidence file containing a captured, redacted event file.
- [x] 1.3 Copy the minimal `ELECTRON_RUN_AS_NODE` file set from a packaged `win-unpacked` into a scratch directory, start the holder entry from it, run the NSIS installer over the original installation, and confirm the holder and a PowerShell PTY survive. Record the file list and its size in `openspec/adr/evidence/windows-holder-runtime-copy.md`. Verified by the evidence file listing the files and a passing survival run.
- [ ] 1.4 Read the current directory of a `cd`-ed PowerShell and of a 32-bit process through `koffi` (PEB and WoW64 PEB), and time 1,000 reads. Record the results in `openspec/adr/evidence/windows-process-observation-koffi.md`. Verified by the evidence file showing correct paths and the per-read cost.
- [x] 1.5 If any spike contradicts design decisions 4, 5, 7 or 8, update `design.md` (and record a superseding ADR if 0080–0082 change) before starting group 3. Verified by `openspec validate native-windows-desktop` passing and the design citing the evidence files.

## 2. Injected-host refactors (Linux-testable)

- [x] 2.1 Make `sessionHolderEnabled` and the holder address resolver take `{ platform, userSid }` and return a pipe name on `win32` instead of `false`. Verified by new `paths.test.ts` cases for win32 naming (SID and data root change the name, and the generation suffix is present) passing on Linux.
- [x] 2.2 Replace `CONTROL_SOCKET_WINDOWS_PIPE` with a resolver that derives the pipe from the SID and the data directory. Verified by `controlSocketPlacement.test.ts` cases for two SIDs and two data directories passing.
- [x] 2.3 Add a platform-neutral Windows foreground selection in `server-core/src/processObservation/` that takes `{pid, ppid, exe, createdAt}` rows, and add a Windows selection that skips `conhost.exe` and `OpenConsole.exe`, prefers the newest child, and returns `limited` for `wsl.exe` roots. Verified by unit tests with recorded Windows snapshots (a PowerShell idle, `node` running under cmd, and WSL) passing on Linux.
- [x] 2.4 Make the Git trace target selection return `{ kind: 'directory', path }` on `win32`, and keep the user's own `GIT_TRACE2_EVENT` untouched. Verified by `gitCommandSocket.test.ts` win32 cases passing.
- [x] 2.5 Make `canInstallInPlace` true for a packaged win32 build under `%LOCALAPPDATA%\Programs\Terminay`, and select `latest.yml` or `beta.yml` by channel. Verified by `scripts/app-updater.test.mjs` win32 cases, replacing the current `false` assertion, passing.
- [x] 2.6 Add a lint or test guard that fails if a test file branches on `process.platform` to choose Windows inputs. Verified by the guard failing on a deliberately added offending test and passing without it.

## 3. Holder protocol with mutual proof

- [x] 3.1 Add a holder protocol version with a nonce exchange and HMAC proofs in both directions, before any session frame, and with no credential on the wire. Verified by holder conformance tests: a peer with a wrong credential gets no frames, an impostor holder receives no input or credential, and a correct pair attaches.
- [x] 3.2 Keep the server speaking the previous holder version for live Unix holders. Verified by the existing generation-compatibility conformance suite passing against a holder started from the previous version.

## 4. Windows implementations

- [ ] 4.1 Add `koffi` as an optional server-core dependency, loaded lazily only on `win32`, with the bindings declared in `processObservation/windows.ts` (Toolhelp snapshot, `OpenProcess`, `GetProcessTimes`, `NtQueryInformationProcess`, `ReadProcessMemory`, token SID, and an SDDL DACL written with `SetFileSecurityW`; no pipe-client lookup, which Node gives no handle for, per ADR-0083). Verified by a Linux test that importing server-core never loads `koffi`, and the Windows probe (6.2) exercising each binding.
- [ ] 4.2 Wire the Windows process observation into `apps/terminay-server/src/processCwd.ts`, and make `electron/processCwd.ts` delegate to it. Verified by the Windows probe asserting that a split after `cd C:\Windows` starts there and that `node` running under cmd is reported busy.
- [ ] 4.3 Implement the holder's Windows pipe transport: the per-SID pipe name, the server closing the holder directory with a DACL and passing the SID to the holder, and admission only through the mutual proof (ADR-0083). Verified by the Windows probe connecting, attaching, and refusing a second listener on the same name.
- [ ] 4.4 Implement the per-build runtime copy (renamed `terminay-session-holder.exe`, renamed into place only when complete), launch from it with `detached` and `windowsHide`, and prune other builds' copies only when their executable can be deleted. Verified by the Windows probe running an in-place upgrade between two builds with a live PowerShell session that keeps running, and a later start removing the old copy.
- [ ] 4.5 Implement the Trace2 directory target: protected DACL, `fs.watch` incremental reads, line and file bounds, deletion on `exit` or at the bound, and emptying on start. Verified by unit tests on the reader with recorded files, and the Windows probe moving a terminal into a worktree it created.
- [ ] 4.6 Enable the holder on `win32` by removing the `false` short-circuit. Verified by the Windows probe's restart step keeping a terminal alive.
- [ ] 4.8 Start interactive PowerShell on Windows with the ADR-0084 location hook. Verified by unit tests of the launch arguments on Linux, and a ConPTY run on `windows-latest` showing the process directory following `Set-Location` and the prompt unchanged.
- [ ] 4.7 Set the AppUserModelID and check single-instance behaviour in `electron/main.ts` for Windows. Verified by the probe launching the app twice and observing one main process and a focused existing window.

## 5. Packaging and release lanes

- [ ] 5.1 Change `electron-builder.json5` `nsis` to `oneClick: true`, `perMachine: false`, `allowToChangeInstallationDirectory: false`, configure `publish` for GitHub so that `latest.yml` is generated, and add `build:win` to `package.json`. Verified by `npm run build:win` on `windows-latest` producing `Terminay-Windows-<v>-Setup.exe`, its blockmap, and `latest.yml`.
- [ ] 5.2 Make `scripts/ensure-node-pty-helper-mode.mjs`, the PTY runtime staging, and the built-in extension staging handle win32: no `spawn-helper`, and stage `conpty.dll`, `OpenConsole.exe`, and the win32-x64 `koffi` and `@napi-rs/canvas` prebuilds. Verified by the packaged `app.asar.unpacked` inventory on the runner listing each file.
- [x] 5.3 Write `scripts/check-windows-pe-architecture.mjs`, which reads every PE `Machine` field and requires x64. Verified by its unit test on Linux with an x64 fixture and an arm64 fixture.
- [ ] 5.4 Add the Windows matrix entry to `.github/workflows/main-prerelease.yml`, running the build, the PE check, the probe, and the upload, with `beta.yml` renamed into place last. Verified by a `main-latest` run publishing the Windows installer and `beta.yml`, and the release-contract tests pinning both asset names.
- [ ] 5.5 Add the Windows matrix entry to `.github/workflows/trigger-release.yml`, with `latest.yml` attached by `publish-release-notes` after the body is final. Verified by the release-contract tests asserting that `latest.yml` is among the last-attached assets, and a tag dry run.

## 6. Windows probe

- [ ] 6.1 Write `scripts/probe-windows-desktop.ps1`: a silent per-user install, launch with an isolated data directory, wait for holder readiness, run PowerShell and cmd (input, resize, output, exit), restart the server with a held terminal, then uninstall. It records the installer's SHA-256 with the result. Verified by the probe passing on a good build and failing, naming the step, when the holder entry is deliberately broken.
- [ ] 6.2 Extend the probe with the parity checks: split directory inheritance, foreground `node` busy, worktree capture, an MCP pipe reachable from the terminal and named per SID, and every built-in extension active with win32-x64 native modules. Verified by each check appearing in the probe record on a `main` run.
- [ ] 6.3 Add the update step: install build N, serve build N+1's `beta.yml` from a local feed, choose Restart to update with a live terminal, and assert there is no UAC prompt, that build N+1 is running, and that the terminal is still alive. Verified by the step passing in the probe record.

## 7. Docs and specs hygiene

- [x] 7.1 Add Windows to the README download section and to `docs/product-overview.md`, with the SmartScreen "More info → Run anyway" note and the WSL-terminal `limited` observation. Verified by review of the rendered README.
- [ ] 7.2 Run `openspec validate --all` and `openspec validate --all --archived`. Verified by both passing.
- [ ] 7.3 Archive only after `linux-glibc-floor`, `terminals-survive-restart`, `linked-folders`, and `worktree-capture-survives-restart` have been archived. Verified by `openspec list` showing those archived before this change's archive commit.
