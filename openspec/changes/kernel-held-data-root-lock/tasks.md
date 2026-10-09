## 1. Server

- [x] 1.1 Hold the data root with an exclusive `node:sqlite` transaction on
      `.terminay-server.lock.sqlite`, kept open until release, and never remove
      that file. Verified by `apps/terminay-server/test/bootstrap.test.mjs`: a
      second lease is refused while the first is held and succeeds after
      release.
- [x] 1.2 Write `.terminay-server.lock` as the owner record after the lock is
      held, and remove it on release. Verified by the same file asserting its
      mode, its contents, that a refused start leaves it unchanged, and that a
      leftover record does not block a start.
- [x] 1.3 Throw `DataRootLockUnavailableError` when the lock cannot be taken
      for a reason other than being held, and have the CLI print it without a
      stack trace and exit non-zero. Verified by a test that puts a directory
      where the lock database goes.
- [x] 1.4 Reword `describeDataRootInUse` for a running holder, with no command
      that removes a file. Verified by the test asserting the container and
      host texts.
- [x] 1.5 Prove the lock follows the process. Verified by a test that holds a
      data root from a separate process, finds the compiled CLI and a second
      lease refused while it runs, kills it with `SIGKILL`, and then takes the
      root.

## 2. Documentation

- [x] 2.1 Rewrite the lock paragraph in the container section of
      `docs/operations/standalone-server.md`. Verified by
      `npm run test:documentation`.

## 3. Close out

- [x] 3.1 `openspec validate --all` passes. Verified by its output.
- [x] 3.2 Confirm on pop-os, with the built lease in two containers of the
      official image on one volume, that the second is refused while the first
      runs or is paused, and that it takes the root after the first is killed.
      Verified by the output recorded in
      `openspec/adr/evidence/kernel-held-data-root-lock-spike.md`.
- [ ] 3.3 Open the pull request on `origin` and read back every commit status.
      Verified by each being `success` or `skipped`.
