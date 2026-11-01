No high- or medium-severity defects remain. The follow-up fixes all four previous findings, but it missed one more place that classifies disconnects. That gap is the only actionable defect I found; the other two items are small regressions in the notice UX.

## Actionable findings

**A. File-observation cleanup doesn't recognise `RequestNotSentError`. Low severity, high confidence. This is confirmed: the same bug as previous finding #1, at a different classifier.**
- **Where:** `packages/client-core/src/fileObservation.ts:155-165`. Its `isExpectedDisconnect` only matches `ClientDisconnectedError`, `CommandOutcomeUnknownError`, `disconnected` and `unknown_command_outcome`. A `RequestNotSentError` (code `unavailable`) is rethrown by `stopWatch` (`:72-76`) and `cancelFolderSize` (`:93-97`).
- **Trigger:** a `files.watch.stop` is still waiting in local admission when the connection drops or closes. That needs 128 requests outstanding or the byte budget full. Folder scans plus watches are the most likely way to get there.
- **Consequence:** these callers use `void` with no `catch`, so you get an unhandled rejection:
  - `src/workspace/DocumentationCatalogController.ts:157`
  - `src/components/folder-viewer/FolderPanel.tsx:1489`
  - `src/workspace/useFileExplorerController.ts:1074`

  The awaited callers (`FolderPanel.tsx:1479`, `useFileExplorerController.ts:1064`, `DocumentationCatalogController.ts:204`) get an unexpected error on teardown. `FolderPanel.tsx:109` catches it, so it's safe. Sync and ordering are not affected.
- **Fix direction:** match `RequestNotSentError` in that classifier too. One shared classifier would be better than the four copies that exist now.
- `src/shared/WorkspaceSnapshotStore.ts:464` has the same gap, but it isn't reachable, because `subscription.unsubscribe()` already filters through `client.ts:83-87`.

**B. A notice becomes permanent for a read-only observer. Low severity (UX regression), high confidence.**
- **Trigger:** an `unknown_outcome` notice is showing, then control moves to another device, or the replacement arrives read-only.
- **Where:** `publishNotice` (`terminalPanelInputQueue.ts:379-381`) sets `canContinue` to false, and the button is disabled (`TerminalPanel.tsx:3304`).
- **Consequence:** the alert stays on until this device takes control again. It covers the bottom of the terminal, where new output and the prompt appear, at `App.css:3761-3765`. The label "Waiting for terminal" is also misleading in this state, because the terminal isn't what it's waiting for; control is.
- Before the follow-up, Dismiss always hid an `unknown_outcome` notice. The overflow notice was already stuck in read-only. The spec delta requires this behaviour, so this is a design question rather than a code bug. A "Read-only" label, or hiding the notice while read-only (but keeping it), would fit the spec.

**C. A stale notice can show an enabled button that does nothing. Low severity, medium confidence.**
- **Trigger:** the current attachment fails while a notice reading `canContinue: true` is showing.
- **Where:** `failServerTransport` → `close()` (`TerminalPanel.tsx:1307`). `close()` (`terminalPanelInputQueue.ts:203-209`) never calls `publishNotice`, and the panel only clears the notice when it builds a new queue (`TerminalPanel.tsx:1719`).
- **Consequence:** Dismiss stays enabled, but `resumeInput()` returns false, so clicking does nothing. It clears once the panel reattaches. It's cosmetic, because the error overlay is also showing.

## Previous findings: verified resolved
- **#1 (unsent request misread):**
  - `client.ts:348` and `requestAdmission.ts:111` throw `RequestNotSentError`.
  - `client.ts:84` recognises it, and `commandWithBody:232` doesn't turn it into an unknown outcome.
  - Project recovery (`projectCreationRecovery.ts:41`) resends safely, bounded by the interruption cap.
  - The renderer queue still resends exactly once on a replaced attachment (`:294` only treats `unknown_command_outcome` and `invalid_response` as uncertain).
  - The new `retryable: true` doesn't trigger any automatic retry: `featureQueryAuthority.ts:187/232` branch on the code first.
  - The server-upgrade check (`serverUpgradeModel.ts:834`) correctly still treats an unsent start as a refusal.
- **#2 (abort reasons):** the shared `abort.ts` is used in all three places: before admission, while waiting, and in `preAbort`. `isCancelledFeatureFailure` is unaffected, since it never saw a `cancelled` code from these paths.
- **#3 (zero-byte holder buffer):** the check at `holder.ts:217` runs before `mkdirSync` and before the constructor. `start` is the only way in, and the test confirms the directory is untouched.
- **#4 (dismissable notices):** fixed. Pending, read-only and hydration all gate the button, and the state is republished on handoff, attach and role change.

## Coverage gaps (not defects)
- No test sends `stopWatch` or `cancelFolderSize` while they are waiting in admission (finding A).
- The abort-after-grant test (`terminal-panel-input-queue.test.mjs`, the `while (waiting.length) await Promise.resolve()` line) depends on microtask ordering. If the `sendRequest` continuation runs before the test's abort, the frame is sent and the test fails. It isn't flaky today, but it could break under a different runtime or transport.
- No test covers a notice when the queue closes (finding C).

Previous speculative items #5 (a huge burst can fail a panel) and #6 (FIFO latency) are unchanged and still bounded trade-offs. The follow-up introduces no ordering, bounds or retry regressions.

# Resumed review after fixes

I found no actionable defects in this round. Findings A, B and C are fixed, and the changes introduce no unsafe replay, no swallowed refusals and no notice-lifecycle regressions. This is from reading the source only; I ran nothing.

## Prior findings, checked
- **A (file-observation cleanup):** one classifier, `connectionLoss.ts:3-9`, now serves `events.unsubscribe` (`client.ts:270`), `stopWatch`, `cancelFolderSize`, `WorkspaceSnapshotStore.close` and project recovery.
  - Generic `unavailable`, `forbidden` and other real refusals still propagate.
  - The renderer can import it, since it is a plain value export like `WorkspaceClient`.
  - The `void` callers can no longer get an unhandled rejection from an unsent cleanup.
- **B (stuck read-only notice):** `publishNotice` hides the notice for read-only but keeps `this.notice`.
  - `overflowPaused` and `waitingForHydration` stay unchanged, so typing is still refused.
  - Regaining control goes through `setPresentationRole('controller')` → `resumeAfterHydration`, which shows the notice again.
  - A write that fails with an unknown outcome while the panel is read-only records the notice but keeps it hidden. That is correct.
- **C (dead button after close):** `close()` now clears the notice. Once closed, the queue can't publish another one: `handoff`, `attach`, `setPresentationRole` and `enqueue` all return early, and the pump's catch returns too.
  - `close()` isn't idempotent, so a second close sends `null` again. That's harmless: all three call sites (`TerminalPanel.tsx:1307`, `:2132`, `:2853`) only close the current queue, and a closed queue is replaced at `:1718`.
  - Clearing an `unknown_outcome` warning on failure loses nothing. Before, the panel already cleared it when it built the replacement queue.

## Introduced-behaviour checks (holding)
- `client.ts` unsubscribe now also follows the cause chain and matches any `Error` with code `disconnected`, not just a `ClientError`. That is slightly broader but still only matches real connection loss.
- The imports `RequestNotSentError`, `ClientDisconnectedError` and `CommandOutcomeUnknownError` in `client.ts` are still used (`:143`, `:232`, `:348`).
- Through the shared classifier, `App.tsx:7408` and `:7514` only retry snapshot reads after waiting for a new connection version. No command is replayed.
- `upgradeStartOutcomeUnknown` (`serverUpgradeModel.ts:834`) and the input queue's uncertain-outcome check (`terminalPanelInputQueue.ts:439`) are correctly left alone. An unsent request stays a refusal there and is never treated as uncertain.

## Optional, not defects
- **Tasks not ticked:** `tasks.md` 6.1 and 6.2 are done but still unchecked. 6.3 reasonably waits for CI. `verification.md` has no entry for this round yet.
- **Brief notice flicker:** a read-only observer whose attachment is replaced will see the notice ("Waiting for terminal", disabled) during `pending`, then lose it again if the replacement is also read-only. The spec allows this.
- **Coverage gap:** no test covers a write with an unknown outcome that settles while the panel is already read-only, where the notice should stay hidden and then appear on gaining control.