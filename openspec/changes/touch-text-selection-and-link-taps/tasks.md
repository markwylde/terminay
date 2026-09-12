## 1. Hold-to-select gesture

- [x] 1.1 Add `createTerminalTouchSelectionSession` in a new
      `src/components/terminalTouchSelectionInteraction.ts`: arms on down,
      disarms on travel past the shared movement threshold, promotes to
      selection after one second, and reports whether the gesture is selecting.
      Verified by `scripts/terminal-touch-selection-and-links.test.mjs` covering
      the pan, tap, hold, cancel, second-finger, and disabled cases.
- [x] 1.2 Add `createTerminalTouchSelectionDriver`, which synthesises the
      `mousedown`/`mousemove`/`mouseup` sequence xterm's selection service
      already understands and lends that service back for the gesture when the
      program is in mouse tracking mode. Verified by the driver tests asserting
      the dispatched sequence and the enable/disable pair.
- [x] 1.3 Wire both into `TerminalPanel` alongside the existing tap session, and
      suppress xterm panning for a selecting gesture with a capture-phase
      `touchmove` listener on the panel root. Verified by typecheck and by
      holding, dragging, and panning in the running web UI on a touch device.
- [x] 1.4 Suppress the focus bridge for a gesture that became a selection so the
      software keyboard does not cover the text just selected. Verified in the
      running app: holding selects without raising the keyboard, and a tap still
      raises it.

## 2. Copy affordance and the per-device toggle

- [x] 2.1 Add `touchSelectionCopyAnchor` and render a Copy pill over the panel
      for a finished touch selection, clamped inside the panel and flipped below
      the finger when there is no room above. Verified by the anchor tests and a
      visual check at both panel edges.
- [x] 2.2 Add `src/shared/touchTextSelectionPreference.ts`: per-device
      `localStorage`, default on, best-effort persistence, change subscription.
      Verified by the gesture honouring it and by storage failure falling back
      to the default.
- [x] 2.3 Add checkable items to the browser menu bar and the
      **Edit > Enable Text Selection** toggle that drives the preference.
      Verified by the tick reflecting and surviving a reload.

## 3. Link activation on touch

- [x] 3.1 Add `activateTerminalLinkAtTouch`, replaying the `mousemove` and the
      next-frame `mouseup` xterm's linkifier needs, whatever the foreground
      program is doing. Verified by the two activation tests, and on device: an
      earlier revision skipped mouse tracking mode and so did nothing in the
      interactive programs whose output carries the links.
- [x] 3.2 Allow modifier-free activation in `createTerminalLinkInteraction` for
      a touch-originated gesture only, and drive it from the panel's pointer
      type. Verified by the link interaction test asserting a pointer click
      without a modifier still opens nothing.
- [x] 3.3 Make `openExternalUrl` and `writeClipboardText` reach the browser API
      inside the live user activation when there is no Desktop bridge to ask.
      Verified by typecheck and by a link tap opening a tab in Safari.

## 4. Specification and verification

- [x] 4.0 Register `scripts/terminal-touch-selection-and-links.test.mjs` in
      `smoke` so CI runs it. Verified by the script appearing in the command.
- [ ] 4.1 Run `npx openspec validate touch-text-selection-and-link-taps --strict`.
      Verified by the command reporting the change valid.
- [ ] 4.2 Run `npm run lint`, `npm run typecheck`, and the touched unit suites.
      Verified by all commands exiting zero.
- [ ] 4.3 Confirm on a real touch device: pan still scrolls, pans a pager, and
      arrows through shell history; hold selects; tap opens a link; the toggle
      off restores today's behaviour exactly.
- [ ] 4.4 Open the pull request with the change branch and confirm CI is green.
      Verified by the PR checks passing.
