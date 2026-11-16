## Context

The terminal-workflows spec ("Workflow panel in the terminal pane") requires the terminal viewport to end left of the vertical panel and above the horizontal drawer. `TerminalPanel` does this by setting `paddingRight` / `paddingBottom` on `.terminal-panel` from `reservedWidth()` / `reservedHeight()` (`src/workspace/workflows/workflowPanelModel.ts`). The minimised app-window rail is a flex item sized by `--app-window-rail`, which `AppWindowHost` sets on the pane.

Overlays that are `position: absolute` children of `.terminal-panel` anchor to its padding-box edges, which ignores that padding:

| Overlay | Anchor | z-index | Effect with a panel/drawer/rail |
|---|---|---|---|
| `.terminal-panel-connection-error` | `inset: auto 12px 12px 12px` | 2 | runs under the panel (z 3); Retry unclickable (#583) |
| `.terminal-input-notice` | inline 12px, bottom 12px | 12 | covers the panel's foot / drawer, and covers the recovery banner when both show |
| `.terminal-paste-progress` (paste and file-drop) | right 10px, bottom 10px | 5 | sits on the panel's foot / drawer / rail, and on the banner |
| `.terminal-search` | top 14px, right 14px; input fixed 220px | 9 | covers the panel header's collapse control |
| `.dictation-overlay` | centred on the pane, bottom 14px | 60 | centred on the whole pane, so it spans under the panel and over the drawer |

`.terminal-panel-loading` covers `inset: 0` at z 2, under the panel; it only hides the terminal and is left as is. In-flow strips (presentation control, MCP approvals, terminal note) already sit inside the padding. The touch copy button and context menus are positioned at pointer coordinates inside the terminal and are unaffected.

## Goals / Non-Goals

**Goals:** every terminal overlay sits in the terminal's area; overlays at the bottom never cover each other; the recovery banner is always operable, wraps at narrow widths, and outranks the panel's narrow-pane overlay; a regression E2E test with real pointer and keyboard activation.

**Non-Goals:** changing the banner's copy, its retry semantics, or when it shows; changing the workflow panel's geometry; the workspace-level reconnect overlay (it covers the whole workspace and is not a pane overlay).

## Decisions

1. **One source for the insets: CSS custom properties on the pane.** `TerminalPanel` already computes the reserved width and height; it also writes them as `--terminal-reserved-right` and `--terminal-reserved-bottom` on `.terminal-panel` (always, `0px` when nothing is reserved). The bottom edge of the terminal area is `--terminal-reserved-bottom + --app-window-rail`. *Alternative:* wrap the xterm root and overlays in a new positioned "terminal area" element. Rejected: the xterm root must remain a sibling React never renders into, the app-window host selects direct children of `.terminal-panel` (`:scope > .terminal-app-window-rail`), and reparenting risks the fit measurement that reads `root.clientWidth + reserved`. *Alternative:* measure in JS and set inline styles per overlay. Rejected: duplicates numbers React already owns and drifts.

2. **One bottom overlay stack.** The input notice, the paste and file-drop progress pills, and the recovery banner render inside one `.terminal-panel-bottom-overlays` element, absolutely positioned at `left: 12px; right: 12px + reserved-right; bottom: 12px + reserved-bottom + app-window-rail`, a `flex-direction: column` with `justify-content: flex-end` and an 8px gap. Its `max-height` is the terminal area's height less its gaps, with `overflow-y: auto`, so a wrapped banner in a short pane scrolls inside the terminal area rather than spilling over the drawer. The container has `pointer-events: none` and its children `auto`, so empty space never blocks the terminal. Order, top to bottom: progress pills (right-aligned, `align-self: flex-end`), input notice, recovery banner — the banner is nearest the edge and is never covered by another bottom overlay. *Alternative:* keep separate absolutes with z-index precedence. Rejected: precedence hides one alert behind another; stacking shows both.

3. **The stack is drawn above the workflow panel (z-index 6 > panel 3, separator 4).** Laid out inside the terminal area, it never overlaps the docked panel, drawer or rail; the stacking only matters for the narrow-pane overlays (panel and drawer), which float over the terminal. A connection failure blocks all terminal use, so its banner wins over a transient, dismissable overlay. It stays below the find bar (9) and dictation (60).

4. **Find bar and dictation.** `.terminal-search` keeps `top: 14px` and moves its right anchor to `14px + reserved-right`; it gains `max-width: calc(100% - 28px - reserved-right)` and its input shrinks (`flex: 0 1 220px; min-width: 0`) so it fits a narrow terminal area instead of pushing its left edge out. `.dictation-overlay` centres within the terminal area (`left` at half of `100% - reserved-right`), width `min(560px, 100% - 28px - reserved-right)`, bottom `14px + reserved-bottom + app-window-rail`.

5. **Banner wrapping.** The banner is `flex-wrap: wrap`; the message takes `flex: 1 1 16rem` with `min-width: 0` and `overflow-wrap: anywhere`; the button keeps `flex: 0 0 auto` with `margin-inline-start: auto`, so on one line it sits right and when wrapped it drops below, right-aligned. Width is bounded by the stack, so nothing extends under the panel.

6. **A test-only fault seam crosses the preload/IPC boundary.** To raise a real, retryable banner deterministically, `terminayLocalConnectionFaultTest` (exposed only when `TERMINAY_TEST=1`, as today) gains `refuseTerminalAttaches(sessionId | null)`. Preload invokes `test:refuse-terminal-attaches`; main checks `assertBoundServerUiEvent`, validates the argument as `null` or a safe session id string, and calls `ServerTerminalAuthority.refuseTerminalAttachesForTest`, which makes the embedded server's terminal service refuse new subscriptions for that one session until cleared with `null`. The IPC handler is registered only under `TERMINAY_TEST`, like the existing `test:` handlers. Production renderer, preload and server behaviour are unchanged. This crosses the preload/main boundary for tests only; it carries no secret, filesystem or PTY capability and is scoped to one session.

## Risks / Trade-offs

- [A future overlay is added with raw `right`/`bottom`] → the requirement states the rule, a CSS comment by the variables names them, and the E2E test asserts geometry against the panel and drawer.
- [Custom property names collide] → names are prefixed `--terminal-reserved-*` and set only on `.terminal-panel`.
- [The stack above the narrow overlay hides part of the overlay] → only while an alert or progress shows; the alert is more urgent than the overlay's step actions.
- [Moving three overlays into one wrapper changes DOM nesting] → selectors are class-based (`panel.locator('.terminal-panel-connection-error')`), so existing tests and the App.tsx readiness probe keep working; checked by running the terminal E2E specs that reference them.
- [The test seam leaks into production] → handler registration and preload exposure are both gated by `TERMINAY_TEST`; verified by reading the gate and by the argument validation unit of the handler.

## Migration Plan

Pure renderer layout plus a test-only seam; ships with the app. Rollback is a revert.

## Open Questions

None. No in-force ADR governs pane overlay geometry; the canonical terminal-workflows layout requirements do, and this design follows them.
