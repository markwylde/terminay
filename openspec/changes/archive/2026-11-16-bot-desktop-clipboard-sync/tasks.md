## 1. Establish background observation

- [x] 1.1 Verify the pinned Electron clipboard API/types and the Chromium clipboardchange contract for background support; document why no exposed background event satisfies the requirement. Verify background copying in the real Mac development app with the selected observation mechanism.
- [x] 1.2 If no usable event source exists, obtain Mark's explicit approval for the design's one 500 ms main-process clipboard check, active only for the sole sharing session; record approval/date in design.md and cite ADR-0028/change at the timer. Verify no periodic monitor is introduced before that approval.

## 2. Add the lifecycle-owned host capability

- [x] 2.1 Add the explicitly negotiated, exact-document text sharing capability to the closed host contract, preload, host helpers, and binding. Verify malformed, foreign-origin, subframe, unbound, and stale-session requests reveal no clipboard text.
- [x] 2.2 Implement one host-wide owner and serialized change delivery with the observation source established in section 1. Verify current-text seeding, changed-text delivery without a paste command, background focus behavior, and no overlapping reads using focused tests.
- [x] 2.3 Retire sessions on owner replacement, view-only, desktop hidden/minimized/closed, disconnection, reload/navigation, and window destruction. Verify observation stops with no owner, pending callbacks have no effects, and an older desktop does not resume automatically.

## 3. Connect clipboard state to the selected bot desktop

- [x] 3.1 Refactor clipboard publication apart from key synthesis and connect host changes to the selected control RFB instance. Verify sync calls clipboardPasteFrom without sending any key and that Ctrl+V remains an ordinary remote paste command.
- [x] 3.2 Implement initial host precedence, revision ordering, line-ending normalization, and echo suppression in both directions. Verify startup remote snapshots, repeated genuine copies, rapid opposing copies, late echoes, and results completing after retirement.
- [x] 3.3 Preserve text limits, Unicode, PRIMARY isolation, and view-only/thumbnail gates; show sharing availability/state and retain native paste where the host capability is absent. Verify files/images/empty or rejected text do not upload stale clipboard contents.
- [x] 3.4 Make Mac paste conveniences construct complete Linux chords, including Shift after asynchronous reads. Verify Cmd+V and Cmd+Shift+V with either Cmd key and with modifiers released before completion.

## 4. Verify the user-visible contract

- [x] 4.1 Run focused Node tests with --test-force-exit and --test-timeout=120000 under an outer timeout, relevant typechecks/builds, and capability/clipboard Electron E2E through npm run test:e2e. Record commands, results, and any unrelated failures.
- [x] 4.2 In the real macOS development app against the bot's Xvnc, copy `i have copied this from my mac` in another Mac app, right-click the bot Chromium address bar, and verify Paste is enabled and inserts the exact text once without any preceding Cmd+V. Independently verify Control+V in the same field.
- [x] 4.3 Verify bot-to-Mac copying, Unicode/multiline text, background changes, reconnect seed ordering, two-window owner replacement, session teardown, and absence of repeated writes or extra readers beyond the approved monitor. Record Mac evidence; do not substitute Linux-only or mocked checks for Mac acceptance.
- [x] 4.4 Remove investigation diagnostics, update verification notes, and run openspec validate --all. Sync/archive only after implementation and required checks actually pass, preserving all artifacts and changes in this worktree.
