# terminay-stream-investigation

I can't prove the cause from source alone, but one mechanism fits every symptom you supplied. It is a latent convergence defect: recovery itself throws away the marker, and nothing ever repaints afterwards. The test isn't wrong and the skip isn't lost.

## Main candidate: recovery hydrates a stale checkpoint, then skips past the marker for good
Medium-high confidence in the mechanism; one diagnostic record would confirm it.

1. **The first congestion is expected.** The renderer is slow on amd64 and acks nothing during the blast, so the lane goes past 256 KiB unacked (`outboundDelivery.ts:465`). Your numbers fit: confirmed ≈700, head ≈266889, queue empty because everything was sent and nothing acked. The lane queues one skip and suppresses itself.
2. **The skip arrives late but is honoured.** It renders behind ~256 KiB of xterm work (`TerminalPanel.tsx:1877-1971`). Recovery then fires after 100 ms (`:325`) and requests a fresh presentation (`:2105-2116`). By then the PTY has probably finished, marker included.
3. **The server pins a lagging checkpoint.**
   - The checkpoint emulator can trail the PTY by up to ~256 KiB before the PTY is paused (`service.ts:50`, `:1692-1700`).
   - It is fed one chunk at a time through headless xterm `write` callbacks (`service.ts:1711-1756`, `presentationCheckpoint.ts:1021-1032`), which yield to the event loop and so are slow on a loaded runner.
   - `settlePresentation` gives up after 250 ms (`service.ts:52`, `:1249`), and the checkpoint is then pinned at whatever the emulator has reached (`protocol.ts:744-748`).
4. **The catch-up is skipped instead of replayed.** If the live head minus the checkpoint head is over 128 KiB (`protocol.ts:766-770`, half the lane bound), the stream starts at the live head. The range from checkpoint to live head goes out as `skip` with reason `hydration` (`protocol.ts:771-775`, `:822-836`). The marker sits inside that range.
5. **Nothing ever recovers from it.**
   - `isRecoverableSkip` excludes `hydration` on purpose (`terminal.ts:1677-1679`). The panel has no branch for it (`TerminalPanel.tsx:1969`) and the recovery controller ignores it (`terminalRecovery.ts:93`).
   - Once the PTY is silent, no new output and no new skip will arrive. The display stays on the checkpoint screen of `x` rows indefinitely. There's no error and no second congestion record, which matches what you saw.
   - Faster arm64 machines usually settle within 250 ms, or have a catch-up under 128 KiB, so the marker gets replayed and the test passes.

**How to confirm (records that are already emitted):**
- The server `attach`/`attached` record (`protocol.ts:986-1001`) for the recovery attach should show `skipCheckpointCatchUp: true`, a `checkpointCatchUp` over 131072, and a `liveHead` beyond ~1.1 MB.
- The client `skip` record (`terminal.ts:830`) should show `reason: 'hydration'` and `recoverable: false`, with no output after it.

## Alternative to rule out
**The skip is lost, or recovery never starts.** The source doesn't support this:
- The skip is queued in the lane's own FIFO and the queue was empty, so it goes out next.
- The attachment-id check and the duplicate check pass for it.
- The controller can only refuse it if it is already recovering.

If there is no `recovery_started` record (`terminalRecovery.ts:145`) for this lane, this alternative becomes the lead instead. A hung recovery attach would show itself through the 15 s recovery timeout error (`TerminalPanel.tsx:1743-1753`). You didn't report that error, so check the screenshots for it.

## Not defects
- **Slow acks.** They go through the renderer write callback, the ack coalescer, client admission and the server feature queue, and are applied after dispatch (`connection.ts:595`, `:874-877`). That is the trigger for the congestion, not the reason it never recovers.
- **Lane release and replacement.** `releaseTerminal` on the replaced attachment (`connection.ts:865-868`) and the fresh lane opened at the live head both behave correctly.

## Fix direction (only once the record confirms it)
Keep the rule that a `hydration` skip doesn't trigger recovery while output is still flowing; that rule is what prevents the hydration loop the comment at `terminal.ts:1669-1676` describes. Add a convergence path that only runs once output has gone quiet:
- After an attach that ended with a `hydration` skip, the panel arms one fresh re-attach, but only after the stream has been quiet for a set period (at least the 250 ms settle deadline).
- The arming is cancelled by any output or by disposal. Consecutive attempts are capped (2–3, with backoff), and the counter resets after a hydration that didn't skip.
- **Why it is safe:**
  - Under sustained output it never fires, so it can't loop.
  - When the PTY is quiet, the checkpoint backlog is finite (at most ~256 KiB plus one chunk), so the next settle succeeds and the checkpoint includes the marker.
  - It changes no bounds, no ordering and no wire format.
  - It reuses the existing handoff, so input already guarded by that path keeps its guarantees: definitely-unsent input is resent once and uncertain input is discarded with a notice.

The server-side alternative is for `settlePresentation` to wait out the drain when the PTY is quiet, the way adoption already waits up to 10 s (`service.ts:57`, `:1230-1241`). That needs a reliable "quiet" signal in the service, and raising the 250 ms deadline on its own would only make the failure rarer, not fix it.

**Test to add:** a deterministic unit test with a fake clock and a fake checkpoint feed that drains slowly. It should cover a hydration skip that lands on the marker followed by silence, and assert that exactly one quiet-gated re-attach shows the marker. The test should also check that sustained output never re-attaches.

# terminay-convergence-review

I found two actionable regressions, both small and both with a contained fix. Everything else holds: timer and attachment fencing, the budget, the first-attach path, input handoff, and acks and bounds (unchanged). The tests are sound at the controller level, but they don't yet prove the end-to-end fix.

## Actionable

**1. A terminal that exits after a hydration gap is re-attached into an error. Medium-low severity, high confidence.**
- **Trigger:** a command produces heavy output, a hydration skip happens, and then the PTY exits. One-shot automation terminals hit this most often.
- **Cause:** `noteStreamProgress` ignores `exit`, because only `output` re-arms and `skip` sets the debt. So the 500 ms convergence timer survives the exit and calls `beginRecovery`. That runs `prepareRecovery`, which shows the loading cover and hands off input, and then starts a fresh attach to a session that has already ended.
- **Consequence:** the attach fails through `isTerminalSessionEndedError` (`TerminalPanel.tsx:2051-2059`). The exit notice and final screen are replaced by "This terminal has exited…" with `presentationUnavailable` set, after auto-close and exit handling have already run. Before this change the exit notice stayed on screen.
- **Fix:** in `noteStreamProgress`, treat `exit` as terminal: cancel the convergence timer and clear `hydrationGap`. Add a test for a hydration skip, then exit, then silence, asserting no reattach.

**2. A connection rebind or manual Retry throws away the convergence debt, so the screen stays stale for good. Medium-low severity, high confidence.**
- **Trigger:** a hydration skip happens, then within the quiet window the connection is rebound (`rebindServerAttachmentRef`, `TerminalPanel.tsx:2149-2156`), or the user presses Retry (`:2123-2129`), or another failure goes through `failServerTransport` (`:1306`).
- **Cause:** all three call `reset()`, and `reset()` now runs `clearConvergence()`, which clears both `hydrationGap` and the budget. The replacement attach then resumes from `renderedPositionRef` with no fresh presentation, so it reproduces the stale checkpoint screen plus the live tail, and no debt is left to fix it.
- **Consequence:** this is the same permanent stale screen the change exists to fix. It's reachable on flaky remote links, where rebinds happen.
- **Fix:** have `reset()` only cancel the timer and set `attached = false`, keeping the gap and the attempt count. Keep the full clear in `dispose()`. Exhaustion already clears the gap before it calls `failServerTransport`, so keeping the budget across a reset can't trigger exhaustion again. Add a test for reset followed by `noteAttached` that expects exactly one convergence refresh.

## Checked and holding
- **Fencing:** the new guard on arrival (`TerminalPanel.tsx:1879`) uses the same conditions as the guard inside the render queue. Retirement only moves one way, so it drops nothing the old code would have rendered.
  - Events from a retired attachment can't set debt or defer the timer, because `prepareRecovery` and `failServerTransport` set `panelAttachment` to null.
  - Every path that re-attaches clears `attached` first: `beginRecovery` for recovery and `reset` for retry and rebind. So a timer can't fire into an attach that is already in progress.
- **Order of events and first attach:**
  - A hydration skip that arrives in `initialEvents` sets the debt before `noteAttached`.
  - One that arrives live afterwards schedules the timer immediately.
  - On the first attach `attached` starts false, so a timer never fires before hydration.
- **Input:** a refresh uses the existing handoff. Definitely-unsent writes are resent once, uncertain ones are discarded with a notice, and the lease is kept (`protocol.ts:784-798`). Typing that echoes delays the refresh. Typing with no echo, such as a password prompt, can see one bounded handoff, and the existing guarantees cover that.
- **No safety changes:** replay, acks, `renderedPositionRef`, queue bounds, wire format and the checkpoint authority are untouched. Acks from the new lane below `confirmedPosition` are ignored, as before.
- **Backoff:** the waits are 500, 1000 and 2000 ms, and the exhaustion check comes at 4000 ms. Exhaustion shows a visible error that can be retried.

## Low / optional
- **Budget reset is keyed to timing.** `noteAttached` resets the budget whenever no gap has been seen yet. If the hydration skip ever arrives after the checkpoint has rendered (for example, a control-priority query result overtakes it in `nextDelivery`), the budget resets every time and is never used up. Under silence the refresh still converges, so this only removes the cap. Making the reset depend on a quiet period that passes with no gap would close it.
- **Exhaustion isn't logged as a renderer recovery failure.** At that point `attempt` is 0, so `failServerTransport` skips `reportTerminalRecovery('failed')`. Only the client-core record is written.
- **Each refresh briefly shows the loading cover.** It's bounded to at most three, but it will make `__terminayResizeTriggeredRecovery`-style checks (`e2e/terminal-presentation-recovery.spec.ts:128-131`) fail whenever a resize test happens to produce a hydration gap.

## Test sufficiency
- **Controller tests:** they cover silence, debounce, exhaustion, reset/dispose and clean-reset well. Missing cases:
  - exit (finding 1)
  - reset followed by re-attach keeping the debt (finding 2)
  - a hydration skip that arrives after `noteAttached`
- **Panel wiring isn't tested:** nothing checks that events from a retired binding never reach `noteStreamProgress`, or that exhaustion leads to `failServerTransport` and a visible error.
- **No deterministic end-to-end proof.** The real E2E only reaches this path when CI is slow, so a green run proves nothing either way. `presentationSettleTimer` can be injected (`service.ts:377`). A server-core or SDK-level test could make the settle wait return immediately, which forces a skip with `catchUp > 128 KiB`. It would then stop output and assert a single refresh whose checkpoint contains the final bytes. That is the real regression guard for the CI failure.

# terminay-convergence-final-review

One actionable defect remains: after convergence exhausts, the Retry button doesn't fix the stale screen. Everything else in the corrected lifecycle holds.

## Actionable
**After exhaustion, Retry resumes onto the stale screen. Medium-low severity, high confidence.**
- **Trigger:** three refreshes in a row end in a hydration skip, so convergence exhausts. The user then clicks Retry, as the error message tells them to.
- **Cause:**
  - On exhaustion, the controller clears `hydrationGap` and calls `failServerTransport`, which calls `reset()`.
  - Retry (`TerminalPanel.tsx:2138-2147`) only asks for a fresh presentation when `lastAttachRefused` is set, and exhaustion never sets it. So Retry resumes from `renderedPositionRef`, which is already past the skipped range.
  - The attach then calls `noteAttached({ freshPresentation: false })` with no debt left, so the display looks healthy but is still stale. That is the silent failure the spec scenario "Convergence exhausts its retry budget" rules out.
- **Second effect:** `reset()` now keeps `convergenceAttempts` at 3. If Retry did attach fresh and got another hydration skip, it would exhaust again after 4 s without making a single refresh.
- **Fix:**
  - In `onHydrationConvergenceExhausted`, set `lastAttachRefused = true` before calling `failServerTransport`. It's declared at `:1174`, so it's in scope, and Retry will then request `fromPosition: 0` with `freshPresentation: true`.
  - Give Retry, but not rebind, a fresh convergence budget: a small `resetConvergenceBudget()` on the controller called from `retryServerAttachmentRef`, or an option on `reset`.
  - Test: exhaustion, then Retry, should give a fresh attach with a full budget.

## Verified holding
- **Late skip:** `beginRecovery` keeps the debt. A clean fresh attach clears it only if `sawHydrationGap` is false. The 500 ms budget-reset timer is cancelled by a hydration skip that arrives late, so the budget is kept.
- **Reconnect resume:** `reset()` keeps the debt and budget, and `noteAttached({ freshPresentation: false })` keeps the gap, so the resume still converges.
- **Exit:** `clearConvergence()` cancels timers and clears both the debt and `attached`, so an ended session can't be re-attached.
- **Normal streaming costs nothing:** with no gap and `attempts === 0`, `scheduleConvergence` does no scheduling. Output only re-arms timers while there is debt or an unspent budget.
- **Server-oracle test:** it's a valid end-to-end guard. A forced stale skip is followed by a real authority drain, and it shows exactly one refresh, the marker in the final checkpoint, and no second gap.

## Housekeeping (not defects)
- The test named "reset cancels hydration convergence debt" now checks that reset cancels the timer while keeping the debt. Renaming it would avoid confusion.
- Tasks 7.1 and 7.2 are still unticked.

# terminay-convergence-last-review

The Retry-after-exhaustion defect is fixed. One narrow case is still open: a connection rebind after exhaustion, which is low severity.

## Closed
- **Exhaustion marks the attach as refused:** `onHydrationConvergenceExhausted` sets `lastAttachRefused = true` before calling `failServerTransport` (`TerminalPanel.tsx:1285-1288`). `failServerTransport` doesn't clear the flag, and no attach can complete in between to clear it at `:2025`.
- **Retry starts fresh with a full budget:** Retry (`:2135`, `:2144-2150`) calls `reset({ renewConvergenceBudget: true })` and then requests `fromPosition: 0` with `freshPresentation: true`. A clean fresh hydration clears the debt at `terminalRecovery.ts:155`. A new hydration skip gets three full attempts.
- **Rebind before exhaustion is unchanged:** it uses plain `reset()`, so the debt and budget are kept (`:173-184`).
- **Test:** `terminal-recovery-controller.test.mjs:253-261` covers renewing the budget at controller level.

## Remaining (low severity, concrete)
**A rebind after exhaustion resumes onto the stale screen with no error.**
- **Trigger:** convergence exhausts, so the error is showing. Then the connection is replaced before the user clicks Retry.
- **Cause:** rebind (`rebindServerAttachmentRef`, around `TerminalPanel.tsx:2155`) clears the error and resumes from `renderedPositionRef` with `freshPresentation: false`. Exhaustion already cleared `hydrationGap` (`terminalRecovery.ts:129`), so `noteAttached({ freshPresentation: false })` has no debt to keep. The hydration path at `:2025` then resets `lastAttachRefused`. The screen looks healthy but is stale.
- **Fix (pick one):**
  - Don't clear `hydrationGap` on exhaustion; only stop scheduling until a reset that renews the budget.
  - Have rebind honour `lastAttachRefused` the way Retry does.

Otherwise, no actionable defects remain. The only bookkeeping left is ticking tasks 7.x once CI is green.

# terminay-convergence-confirm-review

No actionable defects remain in the Retry, rebind and flag wiring.

- **Retry** (`TerminalPanel.tsx:2144-2149`) reads `lastAttachRefused` without clearing it. It requests `fromPosition: 0` with `freshPresentation: true` whenever the flag is set, and it renews the budget (`:2135`).
- **Rebind** (`:2178-2183`) honours the same flag and keeps the budget through a plain `reset()` (`:2161`).
  - **Rebind while a Retry is pending:** the rebind retires the Retry's binding (`:2171`), so that hydration can't finish. The flag stays set and the rebind attaches fresh.
  - **Rebind after exhaustion:** with the budget still at 3, a fresh attach that hits another hydration skip leads to a visible error again, never a silently stale screen. A clean attach clears the debt.
- **Clearing the flag:** only `:2025` clears it, after `noteAttached` and behind the binding, `panelAttachment` and `serverAttachmentFailed` checks (`:2003-2009`). A retired or failed attach can't clear it.
  - The resume-refusal path (`:1963`) retires `panelAttachment` through `prepareRecovery`, so `:2025` can't run for that attach.

One gap in coverage: these three wiring lines aren't tested at panel level. The controller tests cover the budget and debt rules, and the Docker recovery tests ran before this wiring change, so rerun them once on the final head.