# ADR-0115: A session holder takes new sessions only while its environment is healthy

Status: accepted
Date: 2026-11-13

## Context

ADR-0035 made a detached session holder own every PTY, so that terminals
outlive the server. Its §2 decided which holder receives new sessions by build
alone. A holder of the current build is reused; any other is drained.

On a standalone host, `systemctl restart terminay-server` left the surviving
holder in the mount namespace of the stopped service invocation. The unit's
`PrivateTmp=true` had given that invocation a private `/tmp`, and systemd
deletes it on stop. The holder's build matched, so the next server reused it
and every new terminal inherited a `/tmp` that no longer existed. Reopening
terminals and reconnecting changed nothing. Recovery took a manual SIGKILL of
the control group, which ended every session. The spike that approved the
holder under systemd checked that the shell process survived, not that it could
still be used.

A holder that outlives its server also outlives the environment the server ran
in. Build identity says nothing about whether that environment still works.

## Decision

1. **Health is a condition for receiving new sessions, alongside build.** Every
   time a server attaches to a holder, it checks the holder's environment from
   outside the holder. On Linux, the holder must share the server's mount
   namespace, and its temporary directory must exist and be writable from the
   holder's view (`/proc/<pid>/root`). Only a positive result earns new
   sessions: a holder that fails, or that cannot be checked, is drained exactly
   as a build mismatch is (ADR-0035 §2).
2. **New sessions start only in a current-build holder that is healthy or was
   launched by the running server.** When none exists, the server launches one
   beside any drained holders without asking the user.
3. **Damaged sessions are never ended by the health check and never hidden.** A
   live session whose holder has lost a usable temporary directory, while the
   server's own is fine, keeps running, and its panel says exactly that.
   Draining for any other reason flags nothing.
4. **The service unit must not give the server a filesystem view that systemd
   tears down on stop** (`PrivateTmp=`, and any similar directive). Sessions
   outlive the invocation that started them. A release opts in to a shared
   temporary directory through its manifest. The unit changes only between
   stop and start, and is restored byte-for-byte on rollback, so an unsafe
   release never runs with a shared `/tmp`. Because the CLI performing an
   upgrade may predate a unit fix, a server that finds itself in such a view
   requests the repair through the upgrade helper once the helper is idle. The
   helper runs the newly installed CLI, which repairs the unit before it
   resolves any release.
5. **On POSIX, the server's fixed-name scratch files under a shared temporary
   directory are per account, owner-only, verified before use, and written
   exclusively without following symlinks.** Removing `PrivateTmp` must never widen what other accounts can
   read or redirect.
6. **Survival is proven by use.** The gates for persistent sessions exercise
   the shell after a restart (creating a file in its temp directory) under a
   real service manager. A process that is merely still alive is not proof.

## Consequences

- Two holders can run side by side after an unhealthy restart, as they already
  do after an upgrade. The drained one exits with its last session.
- The check works against every holder already deployed, because it needs no
  holder protocol change.
- On hosts where `/proc` hides other processes, health is unknown. Every
  restart then starts a fresh holder, and the old one drains as its sessions
  close. The diagnostics say why.
- The standalone service loses `/tmp` isolation. Rule 5 is what makes that
  safe.
- CI gains a systemd-in-container job for the standalone archive.
