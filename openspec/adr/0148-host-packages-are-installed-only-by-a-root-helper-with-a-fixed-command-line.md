# ADR-0148: Host packages are installed only by a root helper with a fixed command line

Status: accepted
Date: 2026-11-27

## Context

The server desktop (ADR-0145) needs Debian packages that a fresh server does not
have. Users expect the client to install them, with progress, not to be handed
a list of commands.

A system-scope server runs as an unprivileged account with `NoNewPrivileges`,
so it cannot run a package manager, and that is deliberate. In-app upgrade
already crosses the same line: the server changes one file, and systemd starts
a root oneshot whose command line is fixed in the unit, reading nothing the
run-as account wrote (the upgrade helper of ADR-0062).

A client that could name a package or a source could install anything as root.
The trigger file is writable by the run-as account, so anything running as
that account can start the helper without passing the application's authority
check, and could start it repeatedly.

The official container image is different in kind. Its account has
unrestricted passwordless sudo by design, so it is already root-equivalent,
and its `terminay` command resolves through a file that account can write.

## Decision

1. On a system-scope install, Terminay installs host packages **only through a
   root helper whose command line is fixed at install time**, activated by a
   change to a request file and reading no input from the run-as account. The
   server desktop's helper sits beside the upgrade helper and follows its
   shape.
2. The package set is **fixed in the released CLI**. No protocol operation,
   argument, environment variable, or writable file can add a package, a
   version, or a source. The setup operation carries nothing, and the command
   builds the package manager's environment itself.
3. Setup uses the host's **configured package sources only**, installs without
   recommended packages, and leaves no system service newly enabled or
   started.
4. The helper is **safe to trigger by anyone running as the account**: it
   holds a root-side exclusive lock, has a start deadline and a start-rate
   limit, and exits without contacting a package source when the programs are
   already present.
5. Progress is written to a **root-owned status file** the run-as account can
   read and cannot write, separate from the trigger.
6. In the **official image**, where the account is root-equivalent by design,
   the server may run the same command through passwordless sudo. It names the
   image's own root-owned release path, not a path a writable record selects,
   and clears the environment. No containment is claimed there.
7. Where neither exists, Terminay **shows the command** and waits. It never
   asks for a password and never weakens the unit to gain privilege.

## Consequences

- On a system-scope install, a compromised server account can cause the fixed
  set to be installed, at a bounded rate, and nothing else.
- Changing the package set means shipping a release.
- User-scope installs, hardened containers without sudo, and system installs
  made before the helper existed get the copy-and-run path.
- Any later feature that needs host packages uses this helper pattern and adds
  its own fixed set; it does not gain a general "install this" operation.
