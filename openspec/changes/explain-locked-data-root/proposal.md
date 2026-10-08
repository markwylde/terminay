## Why

A standalone server that finds a lock file in its data root exits with an
uncaught `Error: data root is already in use` and a Node stack trace. In a
container that is all `docker logs` shows. The usual cause is ordinary: the
previous container was killed or removed with `docker rm -f`, so it never
removed its lock from the volume. Nothing tells the operator that, or that the
remedy is to remove one file once no other server is using the volume.

## What Changes

- The server reports a locked data root as an operator message on standard
  error: what happened, the data root and lock file, when the lock was written,
  why the server will not clear it on its own, and the commands that do.
- In the official container image the remedy is written for containers and
  volumes. Elsewhere it names the process id the lock records.
- The server exits non-zero without a stack trace, and leaves the lock as it
  found it. The lock is still never treated as stale automatically.
- The container section of the standalone runbook documents the lock.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `server-runtime-and-protocol`: a new requirement for how a standalone server
  reports a data root another server holds or left locked.

## Impact

- `apps/terminay-server/src/dataRootLease.ts`: a typed `DataRootInUseError`
  carrying the lock path and recorded owner, and `describeDataRootInUse`.
- `apps/terminay-server/src/cli.ts`: prints that description and exits.
- `docs/operations/standalone-server.md`.
- No protocol, data format, or lock semantics change.
