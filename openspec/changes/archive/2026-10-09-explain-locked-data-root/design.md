## Context

`FileDataRootLease.acquire` creates `.terminay-server.lock` with `open(..., 'wx')`
and writes the owner's pid and start time into it. `release` removes it, and the
standalone CLI calls `release` on `SIGINT` and `SIGTERM`. A process that is
killed leaves the file behind, and the next `acquire` throws. The CLI does not
catch that, so Node prints the error and its stack.

## Goals / Non-Goals

**Goals:**

- An operator reading the log learns what happened and how to recover.
- The message fits where the server runs: a container, or a host.

**Non-Goals:**

- Removing a stale lock automatically. A pid recorded inside one container
  says nothing about another, and two servers on one data root corrupt it. A
  liveness-checked takeover is a separate decision.

## Decisions

- **A typed error, formatted by a pure function.** `DataRootInUseError` keeps the
  message `data root is already in use`, so embedded callers and existing
  assertions are unaffected, and adds the data root, lock path, and recorded
  owner. `describeDataRootInUse` turns it into text and is tested directly.
- **The CLI owns the exit.** Only the standalone CLI prints the description and
  calls `process.exit(1)`; the embedded server reports the error through its
  own bootstrap failure path.
- **`TERMINAY_MANAGED_BY=container` selects the container remedy.** The image
  already sets it. The container text omits the pid, which belongs to another
  container's namespace, and removes the lock with the image's own `rm`, so no
  second image is needed.
- **Placeholders for the volume and image.** The server cannot know either from
  inside the container, so the commands name `<your-volume>` and `<this-image>`.

## Risks / Trade-offs

- An operator may remove the lock while another server is live. The message
  puts the check first and says why the lock exists.
