## 1. Reserved insets on the pane

- [x] 1.1 In `src/components/TerminalPanel.tsx`, always set `--terminal-reserved-right` and `--terminal-reserved-bottom` (px, `0px` when nothing is reserved) on `.terminal-panel` from `workflowReserved` / `workflowReservedHeight`, alongside the existing padding. Verified by the E2E geometry assertions in 3.2–3.4.

## 2. Overlays in the terminal's area

- [x] 2.1 Wrap the input notice, file-drop progress, paste progress and recovery banner in one `.terminal-panel-bottom-overlays` stack in that order (banner last, nearest the edge); render the wrapper only when one of them shows. Verified by 3.5 and by the existing terminal E2E specs that select these classes.
- [x] 2.2 `src/App.css`: the stack is absolute at `left 12px; right 12px + reserved-right; bottom 12px + reserved-bottom + app-window-rail`, column, end-justified, 8px gap, bounded `max-height` with `overflow-y: auto`, `pointer-events: none` (children `auto`), `z-index: 6`; children become static; progress pills `align-self: flex-end`. Verified by 3.2–3.5.
- [x] 2.3 Banner wraps: `flex-wrap: wrap`; message `flex: 1 1 16rem; min-width: 0; overflow-wrap: anywhere`; button `margin-inline-start: auto`. Verified by 3.3.
- [x] 2.4 `.terminal-search`: right anchor `14px + reserved-right` (top unchanged, no bottom anchor), `max-width` within the terminal area, input `flex: 0 1 220px; min-width: 0`. Verified by 3.4.
- [x] 2.5 `.dictation-overlay` (`src/components/dictationOverlay.css`): centred within the terminal area, width bounded by it, bottom above drawer and app-window rail. Verified by review of the computed rule and by `npm run lint` passing.
- [x] 2.6 A CSS comment by the variables names the rule for future overlays. Verified by review.
- [x] 2.7 `npm run lint` and the project typecheck pass.

## 3. Regression E2E

- [x] 3.1 Test-only seam `terminayLocalConnectionFaultTest.refuseTerminalAttaches(sessionId | null)`: preload exposure stays under `TERMINAY_TEST`; main handler `test:refuse-terminal-attaches` registered only under `TERMINAY_TEST`, calls `assertBoundServerUiEvent`, accepts only `null` or a safe id string; `ServerTerminalAuthority.refuseTerminalAttachesForTest` refuses new subscriptions for that one session until cleared. Verified by 3.2 producing a retryable banner only on the named session and recovering after clearing.
- [x] 3.2 New `e2e/terminal-overlays-workflow-panel.spec.ts`: attach a workflow, expand the panel, refuse attaches and fail the Local connection; assert the banner and **Retry connection** end left of the panel and that the element at the button's centre is the button; clear the refusal and click **Retry connection** with a real pointer click; assert the banner clears and the terminal accepts input.
- [x] 3.3 Same spec: keyboard retry (focus the button, press Enter) beside the collapsed rail; narrow the window so the banner wraps and assert the button is fully inside the banner and left of the panel.
- [x] 3.4 Same spec: horizontal layout with the expanded drawer — the banner sits above the drawer and is clickable; with the vertical panel expanded, open find and assert the find bar ends left of the panel and the panel's collapse control is clickable.
- [x] 3.6 Same spec: in a 560-pixel window the panel is forced to the rail; opening its overlay over the banner leaves **Retry connection** the topmost element at its centre, and clicking it retries. Notices and progress share the banner's stack element, so the stack geometry the banner tests assert (beside panel, rail, above drawer) is theirs too; the notice-with-banner and app-window-rail scenarios have no dedicated E2E because neither state can be raised from a test without a further seam.
- [x] 3.5 Capture screenshots of the banner beside the expanded panel in dark and light themes, the wrapped state, and the drawer state; run `npm run test:e2e -- e2e/terminal-overlays-workflow-panel.spec.ts` plus the existing workflow panel and terminal recovery specs in Docker; all pass.

## 4. Specs

- [x] 4.1 `openspec validate --all` passes; sync the delta into `openspec/specs/terminal-workflows/spec.md` and archive the change once verified.
