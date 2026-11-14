## Why

On a Linux host with AppArmor, a bot's browser never opens. Chromium aborts at
start with `FATAL:sandbox/linux/services/credentials.cc … Permission denied`,
the desktop stays empty, and the bot can only tell the user to weaken the
sandbox. The bot environment requires Chromium to run with its sandbox enabled,
so the browser feature is broken on such hosts (for example Debian 13).

The cause is Docker's default AppArmor profile, `docker-default`. Chromium's
sandbox creates a user namespace. Bot containers already carry a seccomp profile
that allows this, but on kernels where AppArmor mediates user namespaces,
`docker-default` has no `userns` rule and the kernel refuses. Docker Desktop has
no AppArmor, so the problem never showed there.

Turning AppArmor off for bot containers, or running Chromium with
`--no-sandbox`, would fix the symptom by removing a protection. Chromium's
setuid sandbox is no alternative: it needs `CAP_SYS_ADMIN`, which Docker drops.

## What Changes

- Terminay ships an AppArmor profile, `terminay-bot`: Docker's `docker-default`
  rules plus one `userns,` rule. Everything `docker-default` denies stays
  denied.
- `terminay daemon install` and `daemon upgrade` run as root for a system-scope
  install, on a host with AppArmor, write `/etc/apparmor.d/terminay-bot` and
  load it. `daemon upgrade` also runs the new release's host setup before
  starting it, so the release carrying this change installs the profile in the
  same upgrade. An install still on an older release gains it on the following
  upgrade, or at once with `sudo terminay daemon upgrade`. `daemon uninstall`
  removes the file but leaves the loaded profile, so running containers stay
  confined.
- On a Docker engine with AppArmor, the server asks the engine with short probe
  containers whether the default profile allows user namespaces, and if not,
  whether `terminay-bot` is loaded. Bot containers use `terminay-bot` only when
  needed and available.
- A bot container created under a different profile than the one the server
  would now use is out of date, and follows the existing "containers follow the
  current image" rules (recreated on next start, or **Recreate to update**).
- When user namespaces are refused and the profile is not loaded, the bot's
  browser log states that and the fix, so the bot reports a cause instead of a
  raw Chromium crash. Chromium never runs with `--no-sandbox`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-environment`: bot containers run under the `terminay-bot` AppArmor
  profile when the engine needs and has it; a profile change makes a container
  out of date; the browser log states a refused sandbox and its fix.
- `daemon-cli`: system-scope install and upgrade install the AppArmor profile;
  uninstall removes its file.

## Impact

- `packages/server-core/src/botService/`: probe the engine, pass
  `--security-opt apparmor=terminay-bot`, label and compare it.
- `apps/terminay-cli/src/apparmor.ts` (new), `commands/install.ts`,
  `commands/upgrade.ts`, `commands/uninstall.ts`, a hidden `daemon host-setup`.
- `docker/terminay-bot/bin/terminay-browser`: the missing-profile message.
- `docs/operations/standalone-server.md`: the profile and its manual install.
- Security: the profile adds only user-namespace creation, which Chromium needs
  for its sandbox and which the seccomp profile already allows. See ADR-0120.
