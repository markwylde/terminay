## 1. Spike: can a holder outlive its installation

- [x] 1.1 Build a throwaway detached Node script that holds one `node-pty` shell and a socket, launch it from a packaged macOS build with `ELECTRON_RUN_AS_NODE`, run a real in-place update, and record whether Squirrel.Mac waits on or kills it and whether the shell is still interactive afterwards. Verified by: findings written to `openspec/adr/evidence/session-holder-survives-update.md` with the commands run and their output.
- [ ] 1.2 Repeat for a Linux AppImage: quit the app, confirm whether the holder and shell survive the FUSE unmount, then update and relaunch. Verified by: results in the same evidence file, including the fallback decision (run from the mount, or copy the payload into the data root).
- [ ] 1.3 Repeat for the standalone archive under systemd with `KillMode=process`: stop the unit, remove the holder's `versions/<v>` directory, start the unit, and reconnect. Verified by: results in the same evidence file.
- [ ] 1.4 On macOS, check that a shell held after its launching app exited can still use a privacy-protected folder it was granted. Verified by: result in the same evidence file.
- [ ] 1.5 Update `design.md` Decision 11 with the outcomes. Verified by: `openspec validate terminals-survive-restart` passes and the design names the chosen launch method per host. **The macOS outcome is recorded; the AppImage and systemd outcomes wait on 1.2 and 1.3.**

## 2. Holder protocol

- [x] 2.1 Add the holder frame codec and message types (hello, list, spawn, write, resize, signal, end, end-all, read, pause/resume, foreground, set-limit, drain; data, exit events) in `packages/server-core`, with version negotiation. Verified by: unit tests for round-trip encoding, oversized and truncated frames, and version selection.
- [x] 2.2 Add a protocol conformance fixture that pins version 1's wire bytes. Verified by: a test that fails when any v1 frame encoding changes.

## 3. Session holder process

- [x] 3.1 Implement the holder entry point: eager-load `node-pty`, create the 0700 `session-holder/` directory, the 0600 socket and credential file, and refuse a `hello` without the credential. Verified by: tests that a peer without the credential is closed and that file modes are as specified.
- [x] 3.2 Implement sessions: spawn, write, resize, signal, end, exit records, and the bounded per-session ring with a monotonically increasing position that advances past dropped bytes. Verified by: unit tests with a PTY double covering overflow and position continuity.
- [x] 3.3 Implement the one-server lease, drain-only mode (refuse spawn, exit after last session), and exit when empty and unattached. Verified by: tests for a refused second attach, a refused spawn in drain mode, and holder exit.
- [x] 3.4 Implement the unattached limit as a single timer set by `set-limit`, including the no-limit value, and `end-all`. Verified by: fake-timer tests for expiry, cancellation on attach, and no-limit; a grep shows no interval in the holder.
- [x] 3.5 Write tails to `<dataRoot>/session-tails/` on unattached exit, limit expiry, and `SIGTERM`; never for a running attached session. Verified by: tests for each trigger, file mode 0600, and absence of files while attached.
- [x] 3.6 Keep reading PTY output into the ring while unattached so a shell never blocks. Verified by: a test that runs a command producing more than the bound with no server attached and sees it complete.

## 4. Server-core: holder-backed PTYs

- [x] 4.1 Implement a `PtyFactory` backed by the holder client, including starting a detached holder on first use and choosing or creating the current generation by build id. Verified by: integration test that spawns through a real holder process and exchanges input and output.
- [x] 4.2 Add `TerminalService.adopt` and rebuild the replay ring and presentation checkpoint from the holder's buffered range. Verified by: test that a client resubscribing at its acknowledged position after a simulated restart receives exactly the later bytes, and `replay_gap` when its position was dropped.
- [x] 4.3 Add `shutdown({ detach: true })` that disconnects without signalling or marking sessions. Verified by: test that the shell pid is alive and the session record is still `running` after detach.
- [x] 4.4 Resume cwd, foreground-process, and activity observation for adopted sessions from the holder-reported pid and shell path. Verified by: test that an adopted session running `sleep` reports busy without input.
- [x] 4.5 Gate all of the above behind a composition option that defaults off. Verified by: existing terminal-service tests pass unchanged with the option off.

## 5. Start-up reconciliation

- [x] 5.1 Replace `markInterruptedSessions` on load with reconciliation against the holder list: adopt live, mark holder-reported exits `exited` with code, mark unknown sessions `interrupted`. Verified by: unit tests for each of the three outcomes.
- [x] 5.2 Stop calling `discardStaleTerminalState` at start-up; seed a terminal only for a valid-root project with no terminal panel. Verified by: `packages/server-core/test/session-holder-restore.test.mjs` asserting panels, order, and layout are preserved and only a project with no terminal panel is seeded. (`scripts/server-owned-workspace-restore.test.mjs` and `scripts/task20-crash-restart.test.mjs` exercise the hosts, which still spawn in-process until 11.1; they are updated with that flip.)
- [x] 5.3 End holder sessions that have no persisted session record. Verified by: test that an orphan holder session is ended at start-up.
- [x] 5.4 Load tails for ended sessions and delete a tail when its panel closes. Verified by: test that the tail is served as the panel's output and the file is gone after close.
- [x] 5.5 Handle a holder whose protocol versions the server cannot speak: present its sessions as ended, send end-all, still start new sessions. Verified by: test with a stub holder offering only an unknown version.

## 6. Launch environment and integrations audit

- [x] 6.1 List everything `prepareTerminalSession` injects and classify each value as stable across server restarts or not. Verified by: the list recorded in `design.md` under Decision 7.
- [x] 6.2 Make any per-process value data-root-derived or persisted. Verified by: `apps/terminay-server/test/control-capability-persistence.test.mjs`, where a token minted under one capability store is authorized as the same session by a second store restored from the saved digests, and `electron/main.ts` saving on every change and restoring after reattachment.
- [x] 6.3 Confirm agent session binding by ancestry for a reattached shell. Verified by: `packages/server-core/test/session-holder-integrations.test.mjs` — an adopted session is registered again and announced with the pid its shell has had all along, which is what ancestry binding keys on; letting go of it is not announced as an exit; an already-ended session is adopted without a pid. Not run with a real agent process across a real restart.
- [x] 6.4 Decide and implement automation-run and recording behaviour at detach. Decided: neither spans a restart, and no code changed. A graceful shutdown stops a run and ends its terminal as before; after a crash the run is recorded as stopped while its shell, if still held, is reattached as an ordinary terminal; a recording ends as interrupted. Verified by: `session-holder-integrations.test.mjs` for the run recorded as stopped, the existing `recordingService.test.mjs` for the interrupted recording, and the decisions recorded in `design.md`.

## 7. Setting

- [x] 7.1 Add the server-owned background terminal lifetime setting (default 5 minutes, with an until-restart value) and send it to the holder on attach and on change. Verified by: test that changing it issues `set-limit` and that it is in `SERVER_OWNED_TERMINAL_SETTING_KEYS`.
- [x] 7.2 Add the control to Settings. Verified by: `src/terminalSettings.keepTerminals.test.ts` — the field is offered under shell lifecycle with "5 minutes" as its default option, valid values are kept, and the key is excluded from device-stored settings so the generic settings control commits it to the server.

## 8. Ended-session presentation

- [x] 8.1 Render a reconciled `exited` or `interrupted` terminal panel from its tail with the error-styled notice and exit code, and block input. Verified by: `src/components/endedTerminalReplay.test.ts` for the with-tail, without-tail, dropped-earlier-output, and unmounted-panel cases, the notice wording, and the panel disabling input; `packages/server-core/test/session-holder-ended-attach.test.mjs` for the server serving the saved output read-only and refusing input.
- [x] 8.2 Confirm closing it uses the existing exited-terminal close. Verified by: `session-holder-ended-attach.test.mjs` (closing the panel ends what can be read) and `session-holder-restore.test.mjs` (closing one panel ends only that session; the sibling shell keeps running, and a closed ended panel's saved output is deleted).

## 9. Desktop quit and update

- [ ] 9.1 Wire the holder-backed factory in `electron/serverTerminalAuthority.ts` and package the holder entry point and its native files. Verified by: `scripts/packaged-session-holder-macos.test.mjs` (in the macOS CI job) launching the packaged application and asserting a shell under the holder that outlives a quit, and the Linux equivalent against the AppImage. **macOS is done; the Linux AppImage check is not.** The entry is addressed through `app.asar`, not `app.asar.unpacked`: see `openspec/adr/evidence/session-holder-survives-update.md`.
- [x] 9.2 Change graceful shutdown to detach instead of kill. Verified by: `packages/server-core/test/session-holder-restore.test.mjs` asserting a composed server's shutdown leaves both shells alive with no exit recorded, and `scripts/app-quit-plan.test.mjs` pinning that only the End choice ends terminals before shutdown.
- [x] 9.3 Replace the application close dialog with Quit and Keep Terminals / Quit and End Terminals / Cancel, naming the limit; End sends end-all and removes terminal panels before the final state write. Verified by: `scripts/app-quit-plan.test.mjs` for all three buttons, a dismissed dialog, the limit wording, and the idle no-dialog path; `scripts/main-window-close-confirmation.test.mjs` for the last window deferring to the quit confirmation.
- [x] 9.4 Skip the confirmation when a restart to update was requested. Verified by: `scripts/app-quit-plan.test.mjs` (an update restart plans a quit with no question however much is running) and `scripts/app-updater.test.mjs` (the restart flag the quit path reads, and `quitAndInstall` at the final quit).
- [x] 9.5 End-to-end: start a long-running command, quit and relaunch, and assert the same terminal, its scrollback, output produced while closed, and a still-running process; then quit choosing to end terminals and assert nothing is left running. Verified by: `e2e/terminals-survive-restart.spec.ts` passing under `npm run test:e2e`. A second test covers a tab whose session ended while Terminay was closed: it comes back in place with its last output and the notice, starts no replacement, and takes no input.
- [x] 9.6 Guard the E2E suite against leaked holders. The `userDataDir` fixture kills and fails on any session holder still running when a test's data directory is torn down, so a test that starts one must end its terminals. A zero limit is not set by default: the holder is on in one spec only, and that spec depends on the limit being non-zero. Verified by: `e2e/fixtures.ts`, and `e2e/terminals-survive-restart.spec.ts` passing with the guard in place.

## 10. Standalone and CLI

- [ ] 10.1 Wire the holder-backed factory in `apps/terminay-server/src/cli.ts` and add the holder payload to the standalone archive. Verified by: `scripts/probe-standalone-server-archive.mjs` extended to spawn through the holder from an extracted archive.
- [x] 10.2 Set `KillMode=process` in the unit and audit that every other server child exits when the server does. Verified by: `apps/terminay-cli/test/unit.test.mjs` for the unit; `scripts/standalone-session-holder.test.mjs` killing a real server with `SIGKILL` and asserting every process it started is gone except the holder and its shell; `packages/server-core/test/extension-host-parent-loss.test.mjs` for the extension child that the audit found outliving its server.
- [x] 10.3 Make `daemon upgrade` and rollback leave sessions attached. Verified by: `apps/terminay-cli/test/commands.test.mjs` (an upgrade adds the kill mode to an older unit and reloads systemd before it stops the service; a unit that already names one is left alone) and `scripts/standalone-session-holder.test.mjs` (a real server stopped with `SIGTERM` and started again keeps the same shell pid). Upgrade and rollback are both that stop and start around a symlink switch. Not exercised against a real systemd; that is spike 1.3.
- [x] 10.4 Make `daemon uninstall` send end-all and wait for holders to exit. Verified by: `scripts/standalone-session-holder.test.mjs` running the real `terminay-server end-sessions` (holder and shell gone, refused while a server is running, a no-op when nothing is held) and `apps/terminay-cli/test/commands.test.mjs` (uninstall runs it after stopping the service and before removing the server, and still completes when it cannot).
- [ ] 10.5 Extend the ADR-0004 release-gate probe with reattach after server exit on linux-x64, linux-arm64, and macOS arm64. Verified by: the probe passing in CI on each architecture.

## 11. Rollout and documentation

- [ ] 11.1 Turn the option on for Desktop development builds, then standalone `main`, then stable, as separate commits. Verified by: each flip's CI statuses all `success` or `skipped` on Gitea.
- [ ] 11.2 Reconcile `desktop-auto-update`'s "Restart to update" scenario with this change once that change is archived. Verified by: `openspec validate --all` passes and no spec says an update restart shows a confirmation.
- [x] 11.3 Document the holder, its files in the data root, tails at rest, and the unit's kill mode in `docs/operations/` and `docs/product-overview.md`. Verified by: the runbook names the socket, credential, and tail paths and how to end all sessions by hand.
- [ ] 11.4 Run `openspec validate --all`. Verified by: exit code 0.
