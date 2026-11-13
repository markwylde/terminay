## 1. Root-to-service-account launches

- [x] 1.1 Classify a failed `sudo -u` launch from `error.stderr` only, and pass the launched Node.js path to `explainPrivilegeLaunchError` (`apps/terminay-cli/src/socket.ts`). Verify with the `pairing.test.mjs` case "a launch the service account cannot run is named, not reported as a stopped server".
- [x] 1.2 Add `serviceNode(layout)` and `sendToInstalledServer(context, request)` in `context.ts`; route `socketSender` and `daemon status` through them. Verify with the `pairing.test.mjs` case "the dropped client runs on the installed release's own Node.js" and the full CLI suite passing.
- [x] 1.3 Update the "Service account cannot run Node.js" hint to recommend the installed `terminay` launcher first. Verify with the existing `explainPrivilegeLaunchError` test updated to match.

## 2. Elevation through sudo

- [x] 2.1 In `install.ts`, when system scope is chosen by a non-root user on a TTY, re-run `sudo -- <process.execPath> <entry script> daemon install --system` plus `--run-as`, ref, and every flag already given, with inherited stdio, and exit with its status. Guard against re-entry with an environment marker. Verify with a unit test using an injected spawner that asserts the exact argv, that no prompt is asked twice, and that a second re-exec is refused.
- [x] 2.2 Without a TTY or without `sudo`, fail with that command printed using absolute paths, replacing the "Re-run it as: sudo …" text in `assertRootForSystemScope`. Verify with a unit test on the message.

## 3. Service account shell

- [x] 3.1 Create the dedicated account with `/bin/bash`, or `/bin/sh` when bash is absent (`account.ts`). Verify with a unit test using an injected `execFile` that asserts the `useradd` argv.
- [x] 3.2 On install and upgrade, when the dedicated account's shell basename is `nologin` or `false`, run `usermod -s <shell> terminay` and print one line saying so; for a `--run-as` account, only warn. Verify with unit tests for the dedicated-fix, already-fine, and `--run-as` warning cases.
- [x] 3.3 In `packages/server-core/src/shellProfiles/` discovery, treat an environment or passwd shell whose basename is `nologin` or `false` as absent and fall back to `/bin/bash`, then `/bin/sh`. Verify with a server-core test feeding `environmentShell: '/usr/sbin/nologin'` and asserting the resolved system shell.

## 4. Ready means usable

- [x] 4.1 Add the read-only `probe-terminal` op to `apps/terminay-server/src/remote/approvalSocket.ts`, wired in `cli.ts` to resolve the system shell profile as a new terminal would and run it with `-c 'exit 0'`, no PTY, 5 s timeout, output capped at 1 KiB. Verify with `approval-socket.test.mjs` cases for a succeeding shell, a shell exiting 1 with output, and a timeout.
- [x] 4.2 Add `probe-terminal` to the CLI's `ApprovalRequest` types and the inline client; add `verifyUsable(context)` returning named check results (health, socket, terminal) with fix strings, retrying the socket until the readiness deadline. Verify with unit tests using injected senders for each failing check and the all-pass case.
- [x] 4.3 Use `verifyUsable` in `install`, `start`, `upgrade` (including its rollback trigger), and `status.ready`. Install prints "running" only when usable; otherwise it names the failed check and exits non-zero. Verify with updated install/lifecycle/upgrade tests, including "health ready, terminal probe fails → not ready".

## 5. Install flows into pairing

- [x] 5.1 After a usable install on a TTY, print the summary, then a line that Ctrl+C ends pairing and leaves the server running, then run `runPairing` with the install context. Without a TTY print `terminay daemon qr-code`. Verify with an install test using a fake TTY and injected pairing that asserts order and that non-TTY does not pair.

## 6. Doctor

- [x] 6.1 Add `doctor` to `args.ts` and help, and `commands/doctor.ts` with the checks in the spec (unit, runtime as account, account shell, data root owner/mode, socket, health, terminal probe, protocol port), one line each, a fix per failure, exit non-zero on failure, and no writes. Verify with unit tests: all pass; `nologin` shell fails shell and probe checks with the `usermod` fix; asserting no write-capable dependency is called.
- [x] 6.2 Make `doctor` work for user scope without `sudo`. Verify with a user-scope unit test.

## 7. Launcher

- [x] 7.1 Confirm whether the standalone archive ships the CLI. It does: `stageArchiveCli` (`scripts/standalone-cli-bundle.mjs`) bundles it with its own launcher at `bin/terminay`, which runs on the archive's `bin/node`, so the installed launcher hands off to `<prefix>/current/bin/terminay` and no archive change is needed. Verified by reading `build-standalone-server-artifact.mjs` (`entrypoints.cli`) and `standalone-cli-bundle.mjs`.
- [x] 7.2 Write the marker-carrying launcher on install and upgrade to `/usr/local/bin/terminay` (system) or `~/.local/bin/terminay` (user); leave a foreign file alone and say so; warn when `~/.local/bin` is not on `PATH`; uninstall removes only a marked launcher. Verify with unit tests on a temporary system root for write, foreign-file, and uninstall cases.

## 8. Prerelease archive version

- [x] 8.1 Run `node scripts/sync-package-version.mjs "$VERSION"` in `build-archives` of `.github/workflows/main-prerelease.yml` before the archive build, and make `probe-standalone-server-archive.mjs` assert the launcher's baked version equals the expected version. Verify with the workflow contract tests under `scripts/` (`node --test --test-force-exit --test-timeout=120000 scripts/release-*.test.mjs`) and a probe test case.

## 9. Docs, checks, and real-machine verification

- [x] 9.1 Update the standalone operations runbook in `docs/operations/` for elevation, `doctor`, the launcher, and readiness. Verify by reading the rendered section against the spec.
- [ ] 9.2 Resolve the open question on `upgrade --check` exiting 1: reproduce on a fresh dedicated-account install and fix or record its cause. Verify by the journal showing no `check-failed` after startup.
- [x] 9.3 Run `npm run lint`, the CLI, server, and server-core suites, and `openspec validate --all`. All pass, with no new validation failures.
- [ ] 9.4 On a fresh Debian VM as a non-root user with nvm Node.js: `npx terminay@<build> daemon install main` asks for the sudo password once, ends on a QR code, a device pairs, a terminal opens, and `terminay daemon doctor` passes. Verify by the terminal transcript.
