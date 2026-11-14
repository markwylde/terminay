# ADR-0119: Bot containers run under a Terminay AppArmor profile that allows user namespaces

Status: accepted
Date: 2026-11-14

## Context

The bot environment requires Chromium to run with its sandbox. On Linux hosts
where AppArmor mediates user namespaces, Docker's `docker-default` profile has
no `userns` rule, so Chromium's namespace sandbox cannot start and the browser
aborts, even though the bot seccomp profile allows the calls. The setuid sandbox
needs `CAP_SYS_ADMIN`, which Docker drops.

The ways out that remove protection — `--no-sandbox`, `apparmor=unconfined`, or
adding `CAP_SYS_ADMIN` — are rejected.

The server account cannot read the host's loaded AppArmor profiles, and in a
containerized server or Docker Desktop the engine's kernel is not the server's.
Measurements are in
[`evidence/bot-apparmor-userns.md`](evidence/bot-apparmor-userns.md).

## Decision

1. **Terminay owns a `terminay-bot` AppArmor profile.** It is Moby's
   `docker-default` template at `v28.0.0` with one added rule, `userns,`. Every
   other rule is kept.
2. **Root installs it.** For a system-scope install, `daemon install` and
   `daemon upgrade` run as root write and load it on AppArmor hosts, and
   `daemon upgrade` runs the new release's host setup before starting it, so a
   release applies its own host setup in the upgrade that installs it. Failure
   is a warning, never a failed command. `daemon uninstall` removes the file and
   does not unload the profile, because unloading would unconfine running
   containers.
3. **The server asks the engine.** On a Docker engine reporting AppArmor, the
   server runs short probe containers from the bot image, once per process, to
   learn whether the default profile allows user namespaces and, if not,
   whether `terminay-bot` is loaded and does. Bot containers use `terminay-bot`
   only in that case. The server never writes AppArmor policy.
4. **The profile is part of a container's currency.** A container labelled with
   a different AppArmor choice is out of date and follows the existing image
   rules, keeping its home.
5. **Chromium's sandbox is never disabled.** A host where it cannot start
   states the condition and the fix.

## Consequences

- Sandboxed browsers work on AppArmor hosts with no manual step for system-scope
  installs once they run a release with this decision; an install on an older
  release needs one more upgrade, or `sudo terminay daemon upgrade`.
- The profile is a copy of Moby's template and must be reviewed when Moby
  changes `docker-default`.
- User-scope and container-image installs on AppArmor hosts need one documented
  root step to load the profile, then a server restart.
- Podman containers are unchanged.
