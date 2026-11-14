## Context

Bot containers run on the local Docker-compatible engine (ADR-0092) with a
seccomp profile derived from Playwright's, which allows the namespace calls
Chromium's sandbox needs (`browserSandbox.ts`). On a host where AppArmor
mediates user namespaces (AppArmor 4 on kernel 6.x, for example Debian 13),
Docker still applies `docker-default`, which has no `userns` rule, so
`unshare(CLONE_NEWUSER)` fails with `EACCES` and Chromium aborts.

Measured on such a host (Debian 13, kernel 6.12, Docker 26.1.5) with the bot
image; commands and output are in
[`openspec/adr/evidence/bot-apparmor-userns.md`](../../adr/evidence/bot-apparmor-userns.md):

| AppArmor profile | `unshare -Ur id` as `bot` | sandboxed Chromium |
| --- | --- | --- |
| `docker-default` | Permission denied | aborts (`credentials.cc`) |
| `docker-default` + `userns,` | succeeds | renders a page, no `FATAL` |
| unconfined | succeeds | not tried: rejected |

Chromium's setuid helper (`chrome-sandbox`, present in the image) needs
`CAP_SYS_ADMIN` in the bounding set, which Docker drops, so it is not an option.
The kernel's loaded-profile list (`/sys/kernel/security/apparmor/profiles`) is
not readable by the server account, so the server cannot inspect host policy
directly.

## Goals / Non-Goals

**Goals:**

- Sandboxed Chromium works in bot containers on AppArmor hosts, with no manual
  step for a system-scope install once its CLI carries this change.
- Every `docker-default` restriction stays in force.
- A host where the sandbox cannot start says exactly that, with the fix.

**Non-Goals:**

- `--no-sandbox`, `apparmor=unconfined`, `CAP_SYS_ADMIN`, or the setuid sandbox.
- Podman. Its containers keep their native policy.
- Installing the profile for a user-scope install or the container image; both
  lack root on the engine host. They get the documented manual step.

## Decisions

### The profile is Moby's `docker-default` plus `userns,`

`terminay-bot` is Moby's `profiles/apparmor/template.go` at tag `v28.0.0`,
rendered with:

- `Imports`: `#include <tunables/global>`; `InnerImports`:
  `#include <abstractions/base>` (what Moby uses when both exist);
- `Name`: `terminay-bot`; `DaemonProfile`: `unconfined` (dockerd's own label on
  the measured host);
- one added rule after `umount,`: `userns,`.

Every rule of the template is kept, including the signal rules that let the host,
runc, crun, and dockerd stop the container. The text lives in
`apps/terminay-cli/src/apparmor.ts`, because the CLI runs as root; the server
only needs the name.

Boundary: this is the container's mandatory-access-control boundary. The only
permission added is creating a user namespace, which seccomp already allows and
which grants no capability outside the new namespace.

### Root installs it

`installBotAppArmorProfile` runs as root, for a system-scope install only:

1. Skip, without error, when `/sys/kernel/security/apparmor` is absent or
   `apparmor_parser` is not on `PATH`.
2. Write `/etc/apparmor.d/terminay-bot` atomically (temporary file, `chown
   0:0`, `chmod 0644`, rename) whenever its contents, owner, or mode differ.
3. Only after a successful write, run `apparmor_parser -r -W
   /etc/apparmor.d/terminay-bot`, bounded by a timeout.

A failure at any step returns a warning that the command prints; it never fails
the command, because bots still run without it. The host's AppArmor service
loads `/etc/apparmor.d` at boot.

It runs from:

- `daemon install` (system scope), before the service starts;
- `daemon upgrade` as root (manual or the helper's oneshot), at the start,
  whether or not a newer release exists, as the existing helper repair does;
- `daemon host-setup`, a hidden subcommand, which `daemon upgrade` runs from the
  **new** release's directory after switching and before starting it. An
  upgrader always runs the release it is upgrading from; this hook lets the
  release being installed apply its own host setup in the same upgrade.

An install still on a release without this change is upgraded by that old CLI,
which has neither step. It gains the profile on its next upgrade after this one,
or at once with `sudo terminay daemon upgrade`. The server's message says so.

### Uninstall removes the file and leaves the loaded profile

Unloading a profile makes processes confined by it unconfined. Bot containers
can outlive the server, and another install on the host may use the same
profile. So `daemon uninstall` removes `/etc/apparmor.d/terminay-bot` and does
not unload it; the loaded copy keeps confining running containers and is gone at
the next boot. Uninstall prints that.

### The server asks the engine

The server cannot read host policy, and in a containerized server or Docker
Desktop the engine's kernel is not the server's. So the server asks the engine,
once per process, the first time it needs to create or check a bot container on
a Docker engine whose `/info` reports `name=apparmor`:

1. Run the bot image as the `bot` user with the bot seccomp profile and the
   engine default AppArmor profile, executing `unshare -Ur true`. Success means
   user namespaces work without help: the choice is `default`.
2. Otherwise run the same with `--security-opt apparmor=terminay-bot`. Success
   means the profile is loaded and allows them: the choice is `terminay-bot`.
3. Otherwise the choice is `default`, with the browser sandbox reported as
   unavailable because user namespaces are refused and `terminay-bot` is not
   loaded.

Each probe container uses `--network none`, a 20-second deadline, and is
removed afterwards. An engine error during probing (not a non-zero exit) leaves
the choice `default` without a sandbox diagnosis, and is retried on the next
check. Podman and engines without AppArmor are not probed and use `default`.
Because the result is cached for the process, a profile loaded by hand is used
after the server restarts; the docs say so.

Boundary: the probe containers run the bot image under the same seccomp policy
and user as a bot, with no network, mounts, or engine socket.

### The profile is part of a container's currency

Containers carry a label `terminay.apparmor=<terminay-bot|default>`; a missing
label means `default`. A container is current only when its image fingerprint
and its AppArmor label both match what the server would use now. Start-time
recreation and the `current` status use one helper. So:

- `default` → `terminay-bot` (profile installed): a stopped bot is recreated on
  its next start; a running bot shows **Recreate to update**, with the existing
  confirmation.
- `terminay-bot` → `default` (profile gone): the same, so a container naming a
  profile the engine no longer has is replaced instead of failing to start.

Currency follows the label, not inspected effective policy; replacing the loaded
profile's rules in place does not change the label, and does not need to.

### The browser states the condition

When the probe ends in step 3, the container gets
`TERMINAY_BROWSER_SANDBOX=userns-refused-no-profile`. `terminay-browser` then
writes one line at the top of `/tmp/terminay-browser.log` before launching
Chromium: user namespaces are refused in this container and the host has no
`terminay-bot` AppArmor profile, so Chromium's sandbox cannot start; run
`sudo terminay daemon upgrade` on the host, or load the profile by hand (docs).
Chromium is still launched with its sandbox; nothing is weakened.

## Risks / Trade-offs

- Probing adds two short containers, about a second each, the first time a
  server checks a bot on an AppArmor engine.
- The profile is a pinned copy of Moby's template and must be reviewed when Moby
  changes `docker-default`. A test pins it against the `v28.0.0` template text.
- An install still on an older release needs one more upgrade, or one manual
  command, to gain the profile.
