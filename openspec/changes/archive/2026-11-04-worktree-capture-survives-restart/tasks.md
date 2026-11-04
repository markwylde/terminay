## 1. Fixed socket placement

- [x] 1.1 Generalise `apps/terminay-server/src/mcp/controlSocketPlacement.ts` so placement takes the data-directory and runtime-directory file names. The control socket keeps `terminay-mcp-control.sock` and `control.sock`, and the Git socket uses `terminay-git.sock` and `git.sock`. Verify with the existing placement tests passing unchanged, plus a new case where a long data directory resolves the Git socket to `<runtime dir>/git.sock`.
- [x] 1.2 Place the Git socket from the data directory in `electron/serverTerminalAuthority.ts` and `apps/terminay-server/src/cli.ts`, and keep a per-run temporary path only when there is no data directory. Verify by starting the server twice on one data directory and asserting the same socket path both times.

## 2. Tokens that survive a restart

- [x] 2.1 Add a key loader that creates `git-trace.key` (32 random bytes, mode 0600) in the data directory once and reads it afterwards. Verify with a unit test that the key is stable across loads, has mode 0600, and is regenerated when the file is missing.
- [x] 2.2 Make `GitCommandStream` derive tokens as `terminay-` plus the first 24 hex characters of HMAC-SHA256(key, sessionId), and add `adopt(sessionId)`. Keep `release` as the only way a token stops being recognised. Verify with tests that the same session gets the same token from two streams with one key, different keys give different tokens, and a released session's report is ignored.
- [x] 2.3 Have `reattachHeldSessions` call `gitCommands.adopt` for each re-adopted session before the stream handles events. Verify with a composition test in which a reattached session's Git report is attributed (`command.reported` with `attributed: true`) and an orphaned session's is not.

## 3. Stale socket

- [x] 3.1 Make sure a socket file left at the fixed address by a run that never closed does not stop the next run listening there. Verify with a test that leaves a file at the path, starts a stream on it, and asserts that it receives a report.

## 4. Diagnostics

- [x] 4.1 Add a start-up `listening` report (placement `data-directory`, `runtime-directory`, or `per-run`) and an `adopted` count to `WorktreeCaptureReport`, with matching diagnostic event names. Verify with a unit test of the reports and by finding them in the desktop diagnostics log of a dev run.

## 5. End-to-end check

- [x] 5.1 Extend `worktree-capture-end-to-end.test.mjs` with a restart. Launch a shell with stream 1's environment, close stream 1, start stream 2 on the same data directory, adopt the session, and run `git worktree add` from that shell. Verify that the terminal moves into the new folder.
- [x] 5.2 Run `npm run test:e2e` for the suites that cover folders and worktree capture, and record the result in the PR. Verify that the run passes.
- [x] 5.3 Run `openspec validate --all`. Verify that it passes.
