## Why

A standalone server that is killed leaves its lock in the data root, and every
later start refuses until an operator removes one file by hand. On 2026-10-09 a
container upgraded to a new image would not start for that reason, with no
other server anywhere near the volume. The lock is a file whose existence is
the claim, so nothing can tell a lock a dead server left from one a live server
holds, and the server has to refuse both.

## What Changes

- The data-root lock is held by the operating system on behalf of the running
  server process. It ends when that process ends, however it ends, so a killed
  server leaves nothing to clear and the next start simply proceeds.
- A server that is paused or suspended keeps the lock. A second server is
  refused for as long as the first exists, and never because the first went
  quiet.
- A refused start now always means another server is running on the data root.
  The operator message says that, names what holds it, and tells the operator
  to use or stop that server. It no longer offers a command that removes a
  lock.
- `.terminay-server.lock` stays as a record of which server holds the data
  root, for that message. It is no longer what holds it, and a record left by a
  killed server is overwritten by the next one.
- The runbook's container section describes the lock as it now behaves.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `server-runtime-and-protocol`: a new requirement that a data root is held by
  one running server process for exactly as long as that process exists, and
  the locked-data-root message requirement is replaced by one that describes a
  running holder.

## Impact

- `apps/terminay-server/src/dataRootLease.ts`: `FileDataRootLease` takes a
  kernel-held lock through `node:sqlite` on a new file,
  `.terminay-server.lock.sqlite`, and writes the owner record.
  `describeDataRootInUse` is reworded.
- `apps/terminay-server/src/cli.ts`: reports a data root that cannot be locked
  at all.
- `apps/terminay-server/test/bootstrap.test.mjs`.
- `docs/operations/standalone-server.md`.
- `openspec/adr/0055-*` and the spike behind it.
- No new dependency: `node:sqlite` is already the state repository's
  (ADR-0002). No protocol or data format change. The embedded server is
  unaffected; Desktop supplies its own lease.
