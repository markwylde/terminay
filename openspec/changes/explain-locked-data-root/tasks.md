## 1. Server

- [x] 1.1 Throw a typed `DataRootInUseError` carrying the data root, lock path,
      and the owner the lock records. Verified by
      `apps/terminay-server/test/bootstrap.test.mjs`.
- [x] 1.2 Add `describeDataRootInUse` with a container remedy and a host
      remedy. Verified by the same test file asserting both, and a lock that
      cannot be read.
- [x] 1.3 Print the description and exit non-zero from the standalone CLI.
      Verified by the test that starts the compiled CLI on a locked data root
      and finds the remedy, no stack trace, and the lock untouched.

## 2. Documentation

- [x] 2.1 Document the lock in the container section of
      `docs/operations/standalone-server.md`. Verified by
      `npm run test:documentation`.

## 3. Close out

- [x] 3.1 `openspec validate --all` passes. Verified by its output.
- [ ] 3.2 Open the pull request on `origin` and read back every commit status.
      Verified by each being `success` or `skipped`.
