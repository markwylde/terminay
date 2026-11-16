## Why

With a terminal's workflow panel open, the red "Terminal recovery timed out. Retry the connection to continue." banner runs underneath the panel, so its **Retry connection** button sits behind the panel and cannot be clicked (issue #583). The user is stuck on a dead terminal with no way to recover it short of closing the panel or the tab.

The cause is shared by every overlay a terminal pane draws over its terminal: the pane reserves room for the workflow panel (right edge), the workflow drawer (bottom edge) and the minimised app-window rail (bottom) as padding or flex space, but the overlays are absolutely positioned against the pane's edges and ignore that reservation. The find bar (top right) lands on the panel's header and collapse control, and the paste-progress pill and input notice (bottom) land on the panel, drawer or rail.

## What Changes

- The connection-recovery banner, the input notice, the paste and file-upload progress, the find bar and the dictation overlay are laid out inside the terminal's own area: left of the vertical workflow panel or rail, above the horizontal workflow drawer or strip, and above the minimised app-window rail.
- The bottom overlays share one stack, so an input notice or progress pill shows above the recovery banner instead of covering it.
- The stack is drawn above the workflow panel's and drawer's narrow-pane overlays, so **Retry connection** is always reachable.
- The find bar shrinks to fit a narrow terminal area.
- The banner wraps at narrow widths: its message wraps and its action moves under the message rather than being pushed out of view or clipped.
- A regression E2E test opens the workflow panel, forces the recovery banner, and proves **Retry connection** is within the terminal area and receives a real click; screenshots cover dark and light themes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `terminal-workflows`: adds requirements that terminal overlays stay inside the terminal's area beside the workflow panel, drawer and app-window rail; that bottom overlays stack without covering each other; and that the recovery banner stays operable.

## Impact

- `src/components/TerminalPanel.tsx`: exposes the reserved right and bottom insets as CSS custom properties on the pane, and groups the bottom overlays in one stack.
- `src/App.css`, `src/components/dictationOverlay.css`: overlays position from those insets; the banner wraps; the find bar shrinks.
- Test-only seam (`TERMINAY_TEST`): `electron/serverUiPreload.ts`, `electron/main.ts`, `electron/serverTerminalAuthority.ts`, `src/vite-env.d.ts` gain `refuseTerminalAttaches` so E2E can raise a real retryable banner. Inert in production.
- `e2e/`: a new regression spec with the workflow panel open, with screenshots.
- No protocol, persistence or production server behaviour change.
