## Context

Observed on a fresh Debian 13 VM (`fierce-maple`), user `vms` with passwordless `sudo`, Node.js v26 from nvm in `/home/vms` (mode 0700), root's own nvm in `/root` (mode 0700). Installed `terminay daemon install main`, system scope, dedicated account.

- `sudo npx terminay …` → `sudo: npx: command not found` (`secure_path`).
- `npx terminay daemon qr-code` as root → "no running server accepts commands at this data root", although `/var/lib/terminay/approval.sock` existed and answered. Reproduced: `sudo -u terminay /root/.nvm/…/node` → `command not found`; `sudo -u terminay /opt/terminay/current/bin/node` reached the socket at once.
- `sendAsUser` (`apps/terminay-cli/src/socket.ts`) tests `error.message.includes(NO_SERVER_MESSAGE)`. `execFile`'s message begins with the command line, which contains `SOCKET_CLIENT_SOURCE`, which embeds `NO_SERVER_MESSAGE`. So every launch failure became "no running server", and `explainPrivilegeLaunchError`, which would have named the Node.js path, never ran.
- `createDedicatedAccount` (`account.ts`) passes `--shell /usr/sbin/nologin`. systemd sets `SHELL` from passwd for `User=`; shell discovery (`packages/server-core/src/shellProfiles/nodeHost.ts`, `environmentShell`) takes it as the system shell. Journal: `session holder session-ended … exitCode 1` at startup. After `usermod -s /bin/bash terminay` and a restart it was gone.
- `install`/`start` use `waitForReady` on the health port only (`health.ts`). The server's health turns ready before the approval socket is started (`apps/terminay-server/src/cli.ts`, `start()`), and terminals are never exercised.
- `build-archives` in `.github/workflows/main-prerelease.yml` never runs `scripts/sync-package-version.mjs`, so `writeLaunchers` stamps `apps/terminay-server/package.json`'s `0.0.0`. The desktop job does sync.

The fix to `sendAsUser` (stderr-only classification, the release runtime) is already in this worktree with tests.

## Goals / Non-Goals

**Goals:** the stock-VM path (non-root user, nvm, system scope, dedicated account) goes from `npx terminay daemon install` to a scanned QR code with no detours; every failure the CLI reports is the real one.

**Non-Goals:** supporting non-systemd hosts through `install`; package-manager (apt/rpm) distribution; changing the trust model of the approval socket; a GUI installer.

## Decisions

### 1. Elevate by re-running through `sudo` with absolute paths

When system scope is chosen by a non-root user on a terminal, the CLI runs `sudo -- <process.execPath> <entry script> daemon install --system [--run-as …] [ref and flags]` with inherited stdio and exits with its status. Absolute paths sidestep `secure_path`; answers already given are passed as flags so nothing is asked twice. Without a TTY or without `sudo`, print that command.

*Alternatives:* `sudo env PATH=$PATH npx …` (re-resolves the package, re-downloads into root's npm cache, relies on `env` and `npx`); asking for the password ourselves and piping to `sudo -S` (handles a secret the CLI has no business holding). Rejected.

*Boundary:* privilege elevation. Root executes the user's Node.js and the CLI package under the user's home — exactly what `sudo npx` already does, with `sudo` still authenticating. The archive signature check (unchanged) remains what makes the installed server trustworthy.

### 2. The service account runs only the release runtime

`serviceNode(layout)` returns `<prefix>/current/bin/node` when executable, else `process.execPath`. Every `sudo -u <runAs>` launch (socket client, terminal-probe request, doctor checks) uses it. Launch failures are classified from `error.stderr` only.

*Alternative:* install a system-wide Node.js. Not ours to impose, and the release already carries one the service runs on.

*Boundary:* root → service account. Nothing of the CLI install or operator's Node.js crosses it; the client stays inline source.

### 3. A real login shell for the dedicated account, plus a server-side guard

`useradd --shell /bin/bash` (or `/bin/sh` when bash is absent). On install/upgrade, an existing *dedicated* account whose shell is in a refusing set (`nologin`, `false`, by basename) is fixed with `usermod -s`. A `--run-as` account is only warned about — it is a person's account.

Server-side, shell discovery treats a refusing shell from `SHELL`/passwd as absent and falls back to `/bin/bash`, then `/bin/sh`. That protects installs made before this change until they next upgrade, and `--run-as` accounts.

*Alternative:* keep `nologin` (it blocks interactive SSH login) and only use the server fallback. Rejected as the sole fix: tools run inside terminals (`su`, `ssh` to localhost, `sudo -u terminay -i`, editors spawning `$SHELL`) would still see a refusing shell. The account still has no password, so a login shell does not open password login.

*Boundary:* the run-as account decides whose files terminals can reach; giving it a shell does not widen that — its terminals already run arbitrary commands as it.

### 4. Ready means usable, checked as the operator will use it

`verifyUsable(context)` = health ready (existing poll) → socket `status` via `sendToInstalledServer` (retry until the readiness deadline, since the socket starts after health) → socket `probe-terminal`. `install`, `start`, `upgrade` (including its rollback trigger) and `status.ready` use it. Each failure maps to a named check with a fix string shared with `doctor`.

`probe-terminal` (new approval-socket op): the server resolves its system shell profile the same way a new terminal would and runs it with `-c 'exit 0'` (no PTY, no session holder, 5 s timeout), returning `{ ok, shell, exitCode?, output? }` with output capped at 1 KiB. It creates no session and touches no workspace state.

*Alternative:* open a real terminal through the session holder. Heavier, leaves state, and the failure seen here is in the shell, which the lighter probe catches.

*Boundary:* the approval socket is owner-only; a new read-only op adds no authority.

### 5. Install flows into pairing

On a TTY, after a usable result, install calls the existing `runPairing` with the install's context. Ctrl+C ends pairing only; the summary is printed before it.

### 6. `daemon doctor`

New command, read-only, reusing the same check functions as decision 4 plus: unit active/enabled (`systemd`), runtime executable as the account (`sudo -u <runAs> <serviceNode> -e 0`), account shell (`getent passwd`), data root owner/mode (`stat`), protocol port bound (socket `status` and a TCP connect to the configured port on loopback). One line per check, fix command per failure, non-zero on any failure. Works for user scope without `sudo`.

### 7. Launcher

A shell script written by the installer, first line `#!/bin/sh`, a marker comment `# Written by terminay daemon install`, then `exec <prefix>/current/bin/terminay "$@"` — the CLI every archive already ships for its upgrader, which runs on the archive's `bin/node`. A file at the path without the marker is left alone. Uninstall removes it only if it carries the marker.

### 8. Prerelease archive version

Add `node scripts/sync-package-version.mjs "$VERSION"` (with `needs.plan.outputs.version`) to `build-archives` before the archive build, and make `probe-standalone-server-archive.mjs` assert the launcher reports the expected version, so this cannot regress silently.

## Risks / Trade-offs

- [Re-exec loops or loses arguments] → re-exec only when `uid !== 0`, pass an env marker and refuse to re-exec twice; unit-test argument reconstruction.
- [Changing a shell on an account the operator customised] → only the dedicated account, only from a refusing shell, always reported.
- [Readiness gets stricter, so existing installs whose terminals were silently broken now fail `upgrade` and roll back] → intended; the failure names the shell fix, and the shell fix runs before readiness in `upgrade`.
- [Launcher path collides with another tool] → marker check, never overwrite.

## Migration Plan

Existing installs pick up the account-shell fix, launcher, and stricter readiness on their next `daemon install` or `daemon upgrade` (including the in-app upgrader, which runs the new release's CLI as root through the upgrade helper). Rollback is the existing upgrade rollback.

## Open Questions

- The VM journal showed `server upgrade check-failed: the upgrader's check ended with status 1` before the shell fix and not after. Confirm whether the upgrader's `--check` invocation also depended on the account shell; if not, find its cause during apply.
