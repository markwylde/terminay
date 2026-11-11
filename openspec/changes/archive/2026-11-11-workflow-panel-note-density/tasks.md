## 1. Setting and rule

- [x] 1.1 Add a device-local `WorkflowPanelNotes` setting (`full` | `short` | `current`, default `full`) under `terminay.workflowPanelNotes.v1` in `workflowPanelSetting.ts`, with read/set/subscribe/hook mirroring the collapse setting and following `storage` events. Verified by unit tests in `scripts/workflow-ui.test.mjs` covering default, round trip, unknown value, throwing storage, a cross-window `storage` event, and that the key differs from Home's view key.
- [x] 1.2 Move the current-step rule into `workflowPanelModel.ts` as `isCurrentStep`, add `showsStepNote(step, notes)` beside it, and make Home's `isHighlighted` delegate to `isCurrentStep`. Verified by unit tests for each density against each status (including `needs_input` and no current step), and by the existing Home model tests still passing.

## 2. Panel

- [x] 2.1 Render a compact `<select aria-label="Step notes">` with Full / 2 lines / Current only as the last line of the expanded header's summary column (used by the overlay too), wired through a `notes` prop that `TerminalPanel` fills from the setting. Verified by unit render tests of the select and its selected value, and by E2E selecting each option.
- [x] 2.2 Apply the density to step notes: hide per `showsStepNote`, and add a `workflow-panel--notes-<value>` class whose `short` rule clamps notes to two lines; while cut to 2 lines, give each note its full text as `title`. Verified by unit render tests (Current only shows only current notes, Full after 2 lines renders every note in full) and E2E asserting visible notes and the clamped height.
- [x] 2.3 Style the select so the header works at the 200 px panel minimum and in a narrower overlay with a long workflow name: the name wraps and both controls stay fully visible. Verified by E2E bounding-box checks and screenshots at both widths.

## 3. Verification

- [x] 3.1 Extend the workflow E2E suite: Current only hides non-current notes and follows a status change, 2 lines clamps, Full restores, the choice is shared by two split panes and survives a reload, Home keeps its own Notes choice, and choosing a density in the narrow-pane overlay by keyboard keeps it open, sends no terminal input, and Escape still closes it. Capture screenshots of Full, 2 lines, Current only, and the overlay. Verified by `npm run test:e2e` on the spec file.
- [x] 3.2 Run `npm run test:workflow-ui`, `npm run lint`, `npm run typecheck:workspaces`, and `openspec validate workflow-panel-note-density --strict`; `openspec validate --all` shows no failure for this change (other changes' existing failures are the recorded baseline). Verified by their exit status and output.
