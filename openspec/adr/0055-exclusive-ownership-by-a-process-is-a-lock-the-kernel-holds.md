# ADR-0055: Exclusive ownership by a process is a lock the kernel holds, never a file's existence or a heartbeat

Status: accepted
Date: 2026-10-09

## Context

A standalone Terminay Server is the one authority for its data root
(ADR-0017). It claimed the root by creating `.terminay-server.lock`, and the
file's existence was the claim. A server that was killed left the file behind,
and nothing could tell that from a server that was still running, so every
later start refused until an operator removed the file. The recorded process id
could not settle it: in a container every server is pid 1. On 2026-10-09 a
container upgraded to a new image would not start for this reason.

Three ways to tell a dead holder from a live one were considered:

- **A heartbeat.** The holder touches the lock every few seconds, and a lock
  left untouched for longer is taken over. A paused container, a suspended
  machine, or a stalled disk makes a live holder look dead, and a second
  server starts beside it. That is the misfire ADR-0041 describes, here with
  durable state at stake. It also needs a timer that runs for the life of the
  server (ADR-0028), and a crash is followed by a wait.
- **A recorded process id, checked for liveness.** It means nothing outside the
  process namespace that wrote it.
- **A lock the operating system holds for the process.** The kernel knows
  exactly when a process ends, and releases its locks then and at no other
  time.

A spike showed the third works with what the server already ships: an
exclusive SQLite transaction through `node:sqlite` (ADR-0002) holds POSIX
advisory locks that refuse a second container on the same volume, survive a
pause, and are gone the moment the holder is killed
(`./evidence/kernel-held-data-root-lock-spike.md`).

## Decision

1. **When one process must be the only owner of something on disk, the claim
   is a lock the kernel holds on that process's behalf.** It ends when the
   process ends and not before.
2. **A claim is never a file's existence, contents, or age, a recorded process
   id, or a deadline.** A file may record who holds a claim, for a message to a
   person. It decides nothing, and a stale one is overwritten.
3. **The standalone server holds its data root with an exclusive transaction
   on a lock database opened through `node:sqlite`**, kept open for the life of
   the process. No native module is added for locking.
4. **A lock file is never removed.** It is created once and reused, so no
   process can lock an inode another has replaced.
5. **A lock that cannot be taken, for any reason other than being held, is a
   refusal to start.** There is no unlocked fallback.

## Consequences

- A killed server leaves nothing to clear. The operator instruction to remove
  a lock file is gone, and a refused start always means a server is running.
- A paused or suspended server keeps its data root for as long as it exists.
  Stopping it is the only way to free the root.
- Ownership is as strong as the filesystem's locking. A data root on a local
  volume is exact. One on a network filesystem depends on that filesystem, and
  a filesystem that grants every lock gives no protection.
- POSIX locks belong to the process and are dropped when any descriptor for
  the file is closed, so a lock file has exactly one opener in a process.
- Child processes do not inherit the lock. A process that outlives the server,
  such as the session holder (ADR-0035), never keeps the data root held.
- A server released before this decision takes no kernel lock, so a new server
  cannot see one that is running.

## Open items

- The embedded server's lease is supplied by Desktop and is not changed here.
- The session holder's own single-instance claim (ADR-0035) has not been
  reviewed against this decision.
