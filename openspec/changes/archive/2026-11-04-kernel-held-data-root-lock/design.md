## Context

`FileDataRootLease.acquire` creates `.terminay-server.lock` with
`open(..., 'wx')`; the file's existence is the claim. `release` removes it on
`SIGINT` and `SIGTERM`. A killed process leaves the file, and the next start
cannot tell that from a live holder. The recorded pid does not help: in a
container every server is pid 1. `explain-locked-data-root` made the refusal
readable and left "a liveness-checked takeover" as a separate decision. This is
that decision.

The boundary is the data root: one server is the authority for it (ADR-0017),
and two would corrupt its durable state. Only the standalone CLI uses
`FileDataRootLease`; Desktop supplies its own lease to the embedded server.

In-force ADRs that bear on this: ADR-0002 (`node:sqlite` is already a server
dependency), ADR-0017, ADR-0028 (no timers that re-check state), ADR-0033
(Node 24.15.0 is pinned), ADR-0035 (the session holder is a separate process
that outlives the server), and ADR-0041 (a deadline must not count time a
process was suspended).

## Goals / Non-Goals

**Goals:**

- A killed server never blocks the next start.
- Two servers never run on one data root, including when the first is paused
  or the machine slept.
- No new dependency and no timer.

**Non-Goals:**

- Locking across hosts that do not share a kernel, beyond what the filesystem
  provides. Where it provides nothing, the server refuses to start.
- Changing the embedded server's lease.
- Restart policy for the container, or the transient hosted-signaling failure
  seen in the same incident.

## Decisions

- **The kernel holds the lock.** The lease opens
  `.terminay-server.lock.sqlite` with `node:sqlite` and runs `BEGIN EXCLUSIVE`,
  keeping the connection and the transaction open for the life of the process.
  SQLite takes POSIX advisory locks on the file; the kernel drops them when the
  process ends. A second server gets `SQLITE_BUSY` at once and is refused. The
  spike in `openspec/adr/evidence/kernel-held-data-root-lock-spike.md` shows
  this across two containers on one volume, through a pause, and after
  `SIGKILL`.
  - *A heartbeat* (touch the lock every 5 s, take it over after 30 s of
    silence) was the first idea. A paused container, a slept laptop, or a
    stalled disk makes a live server look dead, and the second server starts
    beside it; that is the failure ADR-0041 describes. It also adds a
    permanent timer (ADR-0028) and up to 30 s of waiting after a crash.
  - *A native `flock` addon* gives the same lock and adds a native module to
    build and ship for each architecture. `node:sqlite` is already in the
    server.
  - *Checking the recorded pid* is meaningless across containers.
- **The lock file is never removed.** Unlinking a lock file lets one process
  lock an inode another has just replaced. The file is created once, stays
  empty because the transaction never writes, and is left in place on release.
- **The lock and the record are separate files.** `.terminay-server.lock`
  keeps its name and JSON shape as the owner record: written, by rename, only
  after the kernel lock is held, and removed on release. A refused server reads
  it to say who holds the root. A record left by a killed server, or by a
  server from before this change, is overwritten by the next holder; it never
  decides anything. Putting the record in the lock database was rejected
  because an exclusive lock stops other processes reading it.
- **Anything other than "busy" fails closed.** If the lock database cannot be
  opened or locked for another reason, such as a filesystem without locking,
  `acquire` throws a `DataRootLockUnavailableError` and the CLI prints a short
  message naming the file and the cause, then exits non-zero. The server does
  not fall back to an unlocked start.
- **The refusal message describes a running holder.** It keeps its structure
  and loses the step that removes a file, since there is no longer a stale lock
  to remove. The container text adds that a paused container holds the lock.
- **Child processes do not hold it.** POSIX locks are not inherited, so the
  detached session holder (ADR-0035) and extension hosts never keep a data
  root locked after the server is gone.

## Risks / Trade-offs

- A server from before this change does not take the kernel lock, so a new
  server cannot see one that is running. → The new server keeps writing
  `.terminay-server.lock`, so an older server started beside it still refuses.
  The other order, an older server already running when a new one starts, is
  not detected; with host networking the second fails to bind its port, and
  the upgrade path stops the old container first.
- After a new server is killed, an older server started on the same root
  refuses its leftover record. → Remove the record by hand, as before. This
  only affects a downgrade.
- POSIX locks belong to the process, and closing any descriptor for the file
  drops them. → Only the lease opens the lock database, and it opens it once
  per data root.
- A network filesystem may not honour locks across hosts, or may refuse them.
  → A refusal fails closed. A filesystem that silently grants every lock would
  let two servers start; the runbook says a data root belongs on a local
  volume.

## Migration Plan

None is needed. The first start of a new server on an existing data root
creates the lock database and replaces whatever `.terminay-server.lock` is
there. Rolling back to an older server after a kill needs that record removed
once.
