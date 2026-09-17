## 1. Contain extension child failures in the host

- [x] 1.1 In `packages/server-core/src/extensions/host.ts`, replace `child.once('error')` with a persistent listener that counts the first error of the current child as its failure and records every one; keep a listener attached after `terminateChild` detaches the others. Verified by the new channel-loss test, which fails with an uncaught `write EPIPE` on the previous code.
- [x] 1.2 Pass a callback to every host `send`, treat a `false` return as queued, and record the first refused write per child as `channel-write-failed` with its error code. Verified by the same test asserting one record, `EPIPE`, and `failedWrites: 5` on exit.

## 2. Stop killing a child on a long write queue

- [x] 2.1 In `packages/server-core/src/extensions/child.ts`, treat `process.send` returning `false` as sent, name the refused frame and reason in `agent`/`broker` send errors, and report a fatal error instead of a bare `exit(73)`. Verified by the new backlog test, which fails with "extension child exited" on the previous code.

## 3. Better evidence

- [x] 3.1 Add `channel-write-failed` and `child-error` transitions and `errorCode`, `failedWrites`, `pendingCalls`, `activeAgentPublications` fields in `diagnostics.ts`; map them in `electron/main.ts` and allow the events in `electron/diagnostics/core.ts`. Unrequested `child-exited` is a warning.
- [x] 3.2 Keep `file:` URL paths in `sanitizeDiagnosticText`. Verified by a new test in `scripts/local-desktop-diagnostics-core.test.mjs`.

## 4. Close the same shape elsewhere in Desktop main

- [x] 4.1 Listen for stdin `error` in `aiService/cliProvider.ts`, `electron/aiTabMetadata/service.ts` (both CLIs), and `aiService/parakeetRuntime.ts`; do not write to a stopped Parakeet worker.
- [x] 4.2 Catch and log rejections from the file watcher's `handleWatchEvent` and the remote connection-closed audit write.

## 5. Checks

- [x] 5.1 Run `openspec validate --all`, `npm run lint`, `npm run test:desktop-diagnostics`, and the server-core extension tests. Verified clean.
- [ ] 5.2 Open the pull request on Gitea with `tea`, then read back every commit status on the head SHA and confirm each is `success` or `skipped`.
