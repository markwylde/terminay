## Why

An operator installed Terminay Server on a stock Debian 13 VM, the way most VMs come: logged in as an ordinary user with passwordless `sudo` and Node.js from nvm. The install printed "installed and running", `daemon start` printed "ready", and `daemon qr-code` said no server was running, every time. They never paired. Behind that were three separate faults the CLI either hid or misreported:

- `sudo npx terminay …` fails with `npx: command not found`, because `sudo` resets `PATH` and nvm lives in the user's home. The CLI's own advice ("re-run it as: sudo …") leads straight into this.
- To reach the owner-only approval socket, a root-run CLI re-runs a small client as the service account with the *operator's* Node.js. Under nvm that binary sits in a private home the account cannot enter. The launch fails, and the CLI reports it as "no running server", because it searched the whole error text — which begins with the command line, whose inline client source contains that very message.
- The dedicated `terminay` account is created with `/usr/sbin/nologin` as its shell. The server spawns the account's shell for every terminal, so every terminal exits with status 1 the moment it starts. Pairing would have succeeded onto a server that cannot open a terminal.

`install` and `start` call the server ready on its health endpoint alone, so none of this surfaced. The Nightly also reports itself as version `0.0.0`, which makes a support conversation about what is installed impossible.

## What Changes

- A non-root `daemon install` that needs root re-runs itself through `sudo` using absolute paths to its own Node.js and script, so `sudo` asks for the password and nvm installs work. Without a terminal it prints the exact command instead.
- Every command run as the service account uses the installed release's own Node.js runtime, never the operator's. Launch failures are classified from what the child printed, not from the command line.
- The installer creates the dedicated account with a real login shell, and corrects a `nologin` shell on an existing dedicated account at install and upgrade. The server refuses a non-login shell (`nologin`, `false`) as a terminal program and falls back to `/bin/bash`, then `/bin/sh`.
- "Ready" means usable: `install`, `start`, and `upgrade` report ready only when the health endpoint is ready, the approval socket answers as the service account, and the server can start a terminal. Anything short of that is reported with the failing check and its fix.
- An interactive `daemon install` ends by showing the pairing QR code and waiting for a device, as `daemon qr-code` does.
- New `terminay daemon doctor` checks the install end to end and prints one fix per failed check.
- Install puts a `terminay` launcher on the machine (`/usr/local/bin` for system scope, `~/.local/bin` for user scope) that runs the installed CLI on the release runtime, so later commands need neither `npx` nor `sudo npx`.
- Nightly and Canary server archives carry their real prerelease version.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `daemon-cli`: install scope elevation, run-as account shell, what "ready" means for install/start/upgrade, pairing at the end of install, root-to-service-account launches, a new `doctor` command, an installed launcher, and prerelease archive versions.

## Impact

- `apps/terminay-cli/src/`: `account.ts`, `socket.ts`, `context.ts`, `commands/install.ts`, `commands/lifecycle.ts`, `commands/upgrade.ts`, `commands/pairing.ts`, `args.ts`, new `commands/doctor.ts` and `launcher.ts`.
- `apps/terminay-server/src/remote/approvalSocket.ts` and `cli.ts`: a `probe-terminal` socket operation.
- `packages/server-core/src/shellProfiles/`: refuse non-login shells as the system shell.
- `.github/workflows/main-prerelease.yml`: sync the planned version before building server archives.
- `docs/operations/` standalone runbook: install, doctor, and launcher.
- Operators on existing installs get the account-shell fix and the launcher on their next `daemon install` or `daemon upgrade`.
