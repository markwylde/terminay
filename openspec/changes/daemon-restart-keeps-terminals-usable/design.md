## Context

ADR-0035 moved PTYs into a detached session holder that outlives the server.
Under systemd this depends on `KillMode=process`. The unit also carries
`PrivateTmp=true` (from `terminay-daemon-cli`), which gives each run of the
service a private `/tmp` that systemd deletes when that run stops. The surviving
holder and every shell it spawns keep that deleted `/tmp`.

The server picks a holder for new sessions by build and draining alone
(`factory.ts` `start()`, around line 399). A same-build holder becomes
`current`, so the damage spreads to every new terminal.

Two Codex reviews shaped this design. The first found these problems:

- The system upgrade helper runs the CLI that is already installed
  (`renderUpgradeServiceUnit`).
- `clipboardImage.ts` writes into a shared, fixed-name `/tmp/terminay-clipboard`
  with default permissions.
- "Unknown counts as healthy" keeps the failure mode.
- Restart in place was too large for this change.

The second found these:

- A rollback or downgrade could put an unsafe server under a shared `/tmp`.
- POSIX-only scratch checks would break Windows.
- The repair must not depend on resolving a release.
- The banner's wording must match what was actually detected.
- The session-lifetime wording was wrong.
- The scratch rule's scope was inconsistent.
- The CI gate must really reproduce the older-upgrader case.

## Goals / Non-Goals

**Goals:**

- No restart, upgrade, or repair ever leaves new terminals unable to use `/tmp`.
- Existing faulty installs are repaired with no operator command
  (system scope), or are told exactly what to run (user scope).
- An unsafe server never runs with a shared `/tmp`, including after a rollback
  or downgrade.
- CI fails if any of this regresses.

**Non-Goals:**

- Repairing a running shell's mount namespace. An unprivileged process under
  `NoNewPrivileges` cannot do it.
- Restart in place. That is a follow-up change.
- Holder health on macOS or Windows. Neither has mount namespaces or systemd.
- Monitoring `/tmp` continuously while the server runs.

## Decisions

### 1. Harden the fixed-name scratch directories (POSIX), keep Windows as is

**Choice:** add `packages/server-core/src/scratchDirectory.ts`. On macOS and
Linux it owns `<tmpdir>/terminay-<uid>`. It creates the root with mode 0700.
Before each use it calls `lstat` and requires a directory that is not a
symlink, has `uid === process.getuid()`, and has `(mode & 0o077) === 0`. Files
are opened with `O_CREAT|O_EXCL|O_NOFOLLOW`, mode 0600. Clipboard images,
`terminay-drops`, and the attachment directory become subdirectories of the
root.

On Windows, `os.tmpdir()` is already the user's own `%TEMP%`, so the helper
returns `<tmpdir>/terminay` with no POSIX checks, and files are still created
exclusively.

Not covered: `mkdtemp` call sites, which already get a fresh 0700 directory,
and the socket runtime directory, which ADR-0054 validates.
`parakeetProvider.ts` writes only inside a fresh `mkdtemp` directory, so it stays where it is.

**Boundary:** the server's file-write boundary on a multi-user host.

### 2. The unit's `PrivateTmp` follows the active release, transactionally

**Choice:** the build adds `"sharedTmpSafe": true` to the archive manifest
(`apps/terminay-cli/src/manifest.ts` and `scripts/standalone-artifact.mjs`).
`unitFor(release)` renders the unit without `PrivateTmp` for a safe release and
with it otherwise. In `upgrade`:

1. Read and keep `unitBefore`.
2. Stop the service and activate the new version.
3. Write `unitFor(new)`, then run `daemon-reload` if it changed.
4. Start the service and check readiness.
5. On rollback: write `unitBefore`, run `daemon-reload`, activate the previous
   version, and start it.

The unit no longer changes before the stop. That never helped anyway: systemd
tears down the private `/tmp` of the run being stopped whatever the file now
says.

**Why:** an older release with the unsafe clipboard writes must not end up
with a shared `/tmp` after a rollback or downgrade.

### 3. Repair before release resolution

`upgrade` computes `mismatch = unitOnDisk !== unitFor(active)` first, before
`assertChannelToFollow` and `resolveUpgradeTarget`. If no upgrade then runs, for
any reason (already current, no channel, resolution failed, or staging failed),
and `mismatch` is true, it rewrites the unit, reloads, restarts once, and waits
for readiness. It then returns or rethrows the original outcome. If an upgrade
does run, decision 2 handles the unit.

### 4. The server requests its own repair

At start-up, a safe-release server reads `/proc/self/mountinfo`. A private
`/tmp` shows as the `/tmp` mount entry whose root path contains
`/systemd-private-`.

- **System scope:** the server polls
  `systemctl is-active terminay-server-upgrade.service` with a bounded backoff,
  up to the helper's 30-minute `TimeoutStartSec`. Once the helper is inactive,
  it writes the existing request file that `PathChanged` watches. This
  matters because an older upgrader may still be running its readiness wait,
  and a path trigger that arrives while the oneshot is active is merged into
  that run and lost. The helper then runs
  `<prefix>/current/bin/terminay daemon upgrade --system`, which is the new CLI,
  and decision 3 repairs the unit. The attempt is recorded in the data root by
  boot id, so the server tries at most once per boot.
- **User scope, no helper, or a timeout:** the server reports in diagnostics and
  in the health payload that `daemon status` reads, together with the exact
  command to run.

**Boundary:** this crosses the privilege boundary between the service account
and root. The crossing already exists: the helper takes no input from the
request file, and its command is fixed. `systemctl is-active` is a read-only
query that unprivileged users may make.

### 5. Health check: only a positive result earns new sessions

`checkHolderHealth(pid)` (Linux) returns separate facts:
`{ sameNamespace, tmp: ok|missing|unwritable|unknown, tmpdir: … }`.

- **Eligible for new sessions** only when the namespace is the same and both
  temporary paths are `ok`. Anything else, `unknown` included, drains the
  holder.
- **Degraded (banner)** only when `tmp` or `tmpdir` is `missing` or
  `unwritable`, and the server's own probe of the same paths passes.
- **Server's own probe fails:** the problem is host-wide. No banner is shown,
  the server reports it once, and it still launches holders, because refusing
  would only add an outage.

A holder this server launched itself is trusted without a check, because it
inherited this server's environment. The procfs reads need
`PTRACE_MODE_READ_FSCREDS`, which normally succeeds for a dumpable holder with
the same uid and gid. Yama restricts attach, not reads. `hidepid=4`, LSMs, or a
non-dumpable holder give `unknown`.

### 6. Banner only, truthful, and lifetime unchanged

`HeldSessionSummary.degraded` is set only by the banner rule in decision 5.
The banner reads: "This terminal's temporary directory is no longer usable.
New terminals are not affected." It has no action. The health check never ends
a session. A shell exiting, the unattached limit, and the removal of a
project's root all end a degraded session exactly as they end any other.

### 7. The CI gate

A `standalone-systemd-restart` job runs in a Debian 12 container with systemd
as PID 1, bounded with `timeout`. Each scenario starts on a fresh data root
after `terminay-server end-sessions`.

- **A (restarts):** install the archive under test. Open S1. Restart twice.
  Open S2. Both S1 and S2 must `mkdir /tmp/x-$$`.
- **B (older upgrader):** install a pinned pre-change release
  (`PRE_SHARED_TMP_RELEASE` in the job) with the real installer, so it writes
  its own `PrivateTmp` unit. Open S1. Then stop the service, stage the archive
  under test, switch `current`, and start, without touching the unit, which is
  exactly what the older upgrader does. Hold a fake active helper for 10 s
  before releasing it, to cover the wait. Then assert: the repair was requested
  only after the helper was inactive, the unit has no `PrivateTmp`, S1 is
  `degraded`, a new S2 can `mkdir /tmp`, and the drained holder exits once S1
  is closed.
- **C (already current, offline):** a current install with a mismatched unit
  and no network. `daemon upgrade` repairs the unit, restarts once, then
  reports the network failure.
- **D (rollback):** upgrade to a build that fails readiness. The unit's bytes
  are restored.

Survival is judged only from shell output.

## Risks / Trade-offs

- [The mountinfo pattern changes in a future systemd] → scenario B catches it
  on the systemd version we target, and the holder health check still keeps new
  terminals working.
- [The repair restart damages the shells open at that moment] → it happens once
  per faulty host, and those shells show the banner.
- [`unknown` on hardened hosts adds a holder on every restart] → sessions
  survive in the drained holder, which exits as they close. Diagnostics say
  why.
- [The pinned pre-change release disappears from the release server] → the job
  caches it as a CI artifact, and the pin is updated deliberately.
- [The scratch path changes for agents that expect `/tmp/terminay-clipboard`]
  → the path is always handed to the terminal. Task 1.4 searches for hardcoded
  uses.

## Migration Plan

One release. Faulty system-scope hosts repair themselves on first start, after
any upgrade helper run has finished, at the cost of one extra restart.
User-scope hosts are told to run `terminay daemon upgrade`. A rollback restores
the previous unit, and a downgrade to an unsafe release puts `PrivateTmp` back.

## Open Questions

None. ADR-0035 stays in force, and ADR-0115 adds the health condition and the
unit rule.
