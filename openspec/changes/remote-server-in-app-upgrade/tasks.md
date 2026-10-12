## 1. Upgrader in the server archive

- [x] 1.1 Add the built CLI and a `bin/terminay` wrapper to the archive in `scripts/standalone-artifact.mjs`, listed in the artifact manifest. Verified by an archive test asserting the wrapper runs `daemon --help` on the archive's Node with `PATH` emptied.
- [x] 1.2 Fail the release when the archive's CLI and the npm package embed different release public keys. Verified by a release-config test with a mismatched key.
- [x] 1.3 Point the image's `terminay` command at the archive's CLI and drop the separate `/opt/terminay-cli` copy. Verified by the container image smoke running `terminay daemon status`.

## 2. Release check and status on the server

- [x] 2.1 Add `daemon upgrade --check` to the CLI, printing the one-line JSON contract in design.md decision 1 for user, system, and container installs, and export `TERMINAY_UPGRADER` from the archive's server launcher. Verified by CLI tests for newer, equal, older, source, missing helper, and unreachable release metadata against a fake release API.
- [x] 2.2 Implement the release check in the server by running the upgrader's `--check`, off when `TERMINAY_UPGRADER` is absent (embedded server, checkout). Verified by unit tests with a fake upgrader for available, none, check error keeping the last result, and no upgrader.
- [x] 2.3 Run the check at start, on attach when stale, and hourly while a client is attached, with the timer armed on first attach and cleared on last detach and a comment citing ADR-0028 and this change. Verified by a fake-clock test asserting no request while no client is attached.
- [x] 2.4 Add the optional `server.upgrade` capability, the status type, and its publication to every attached client in `packages/protocol` and the server. Verified by a protocol test that two clients receive the same status and a client of a server without the capability receives none.
- [x] 2.5 Read the upgrade outcome record at startup and fold it into the status. Verified by unit tests for success, rollback, and absent record.

## 3. Upgrade operation

- [x] 3.1 Add `server.upgrade.start { mode }` with a strict schema. Verified by tests that reject extra fields, an unoffered mode, a request with none available, and a second request while one runs.
- [x] 3.2 Detect what the server can do — user scope, system scope with or without the helper, container with or without a usable socket — and report `canUpgrade`, `modes`, and the unavailable reason and command. Verified by unit tests over each environment.
- [ ] 3.3 User scope: spawn the archive's `terminay daemon upgrade --user` in its own session with output to a log under the prefix. Verified by the daemon CLI smoke upgrading a user-scope install from a running server and finding a shell still alive.
- [x] 3.4 System scope: touch the request file. Verified together with 4.3.

## 4. System-scope helper in the CLI

- [x] 4.1 Render `terminay-upgrade.path` and `terminay-upgrade.service` in `unit.ts`. Verified by unit tests on the rendered units: fixed `ExecStart`, root, no reference to the request file's contents.
- [x] 4.2 Write, enable, and remove the helper in `install`, `upgrade` (adding it when missing), and `uninstall`; create the request directory writable only by the run-as account. Verified by `install.test`, `commands.test`, and a systemd test asserting ownership and modes.
- [x] 4.3 End-to-end in the systemd container fixture: a system-scope server touches the request file, the oneshot upgrades, the server returns ready on the new release, and a shell survived. Verified by the daemon CLI smoke.
- [x] 4.4 Write `upgrade-result.json` beside `versions/` on success and rollback. Verified by upgrade tests asserting its contents in both cases.

## 5. Container in-place upgrade

- [x] 5.1 Replace the `exec` in `docker/terminay-server-entrypoint` with a supervisor that forwards signals, restarts on a requested restart, and otherwise exits with the server's status. Verified by a container smoke asserting PID 1 is unchanged across a requested restart and that `docker stop` exits within the stop timeout.
- [x] 5.2 Release selection script owned by the image: marked release when it verifies and is not older than the image's, else the image's. Verified by unit tests for upgraded, damaged, and newer-image cases.
- [x] 5.3 Container path for `daemon upgrade`: stage under `<data root>/releases/`, mark, request restart, wait for readiness, roll back, retain one previous; `install`, `start`, `stop`, `uninstall` still refuse. Verified by CLI tests and a container smoke that upgrades with a read-only root filesystem.
- [x] 5.4 Container smoke for persistence: upgrade in place, `docker restart`, then recreate from the old image on the same volume; the upgraded release runs each time, and a shell survives the upgrade itself. Verified by `scripts/container-image-smoke.mjs`.
- [ ] 5.5 Server side: in a container, start the in-place upgrade by spawning the archive's CLI detached. Verified by 5.4 driven through the protocol operation.

## 6. Container recreate mode

- [x] 6.1 Detect a usable Docker socket and offer `recreate` in the status, marked as ending terminals. Verified by unit tests with a fake socket present, absent, and unresponsive.
- [x] 6.2 Resolve the target image reference from the container's own inspect data. Verified by unit tests for `latest`, `main`, a version tag, and a digest-pinned reference (refused with a reason).
- [ ] 6.3 Helper container that replaces the container from inspected configuration and restores the old one when the new one is not healthy. Verified by a Docker-in-Docker smoke for success and for a deliberately unhealthy image.

## 7. Client

- [x] 7.1 Carry upgrade status per connection in the workspace client. Verified by a client test that status for one attached server does not affect another.
- [x] 7.2 Warning icon and accessible name on the header connections control for the active tab's server, never for Local. Verified by component tests and an E2E scenario.
- [x] 7.3 Connection menu row: available version, **Upgrade server…**, or the reason and copyable command. Verified by component tests for each status shape.
- [x] 7.4 Confirmation in the shared modal frame, with the mode choice when recreate is offered. Verified by component tests that nothing is sent before confirm and that in-place is preselected.
- [x] 7.5 In-progress and outcome presentation, including the did-not-come-back case. Verified by an E2E scenario against a fake server that reports in-progress, drops, and returns with success and with rollback.
- [x] 7.6 Phone-width layout of the icon, row, and confirmation. Verified by the phone-width E2E project.

## 8. Documentation

- [x] 8.1 Runbook: in-app upgrade, the system-scope helper and the one-time manual upgrade, in-place container upgrade and what the image tag now means. Verified by review against the specs and the runbook link check.
- [x] 8.2 Runbook: the optional Docker socket mount, stated as giving the container's terminals control of the host's Docker daemon. Verified by review.
- [x] 8.3 Update `apps/terminay-cli/README.md` and the `daemon` command table for `upgrade` inside a container. Verified by review.

## 9. Validation

- [x] 9.1 `openspec validate --all` passes. Verified by its output.
- [ ] 9.2 Unit, CLI, and smoke suites pass; `npm run test:e2e` passes. Verified by their output.
- [ ] 9.3 Pull request opened on `origin` and every Gitea commit status read back as `success` or `skipped`. Verified by the status listing.
