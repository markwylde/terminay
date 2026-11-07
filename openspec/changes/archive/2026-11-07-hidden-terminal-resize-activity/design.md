## Context

Background project and folder workspaces stay mounted and are hidden with `visibility: hidden`, so the browser keeps laying them out at full size. Each `TerminalPanel` watches its root with a `ResizeObserver` and, when it controls the session, submits a PTY resize whenever its grid changes. The only guard is a zero-size root. So a viewport change resizes every mounted terminal in the window. On a phone, the browser chrome, keyboard and rotation change the viewport constantly.

On the server, `TerminalService.resize` applies a changed size to the PTY. The shell answers `SIGWINCH` by redrawing its prompt. `TerminalActivityReducer.applyRawOutput` treats that redraw as raw output; the session is settled, so it clears acknowledgement, turns `working`, and then finishes with a notification. The reducer already ignores raw output within `DEFAULT_RAW_ACTIVITY_MS` (1 s) of user input, and the terminal service already drops same-size resizes for the same reason.

## Goals / Non-Goals

**Goals:**
- A terminal that is off screen never resizes its PTY.
- A resize's own redraw never reads as work, wherever the resize came from (another device, a visible panel, a holder).

**Non-Goals:**
- Changing how read-only observers scale the canonical grid.
- Changing structured, foreground, or provider activity.
- Unmounting background workspaces.

## Decisions

1. **Visibility reaches the panel through a React context, not the DOM.** `ProjectWorkspace` already knows `isActive` (the project and folder on screen). It provides a `TerminalWorkspaceVisibleContext` boolean around its Dockview. `TerminalPanel` mirrors it into a ref. Alternatives: reading `getComputedStyle(root).visibility` on every fit (no signal when visibility flips back, so it would still need an observer), or a `MutationObserver` on the workspace class (couples the panel to CSS class names). The context defaults to `true`, so other hosts (app windows, mirrors, auxiliary routes) keep today's behaviour. This stays inside the renderer and crosses no privilege boundary.

2. **A hidden panel defers the whole fit, not just the resize.** `fitAndResizeNow` returns early while hidden. It records that a fit is owed, and whether it was forced, without touching `lastFitSize`. When the context turns `true`, the panel runs the owed fit once. A local fit of a hidden emulator is wasted work, and keeping `lastFitSize` stale guarantees the reveal fit sees the change. The settings refresh path that resizes directly follows the same rule.

3. **The terminal service reports applied resizes; activity treats them as a signal.** `TerminalService` gains `onResize(listener)`, called for each changed size just before it is applied to the PTY, so the redraw can never arrive ahead of the window opening (same-size requests still return early and report nothing). Server composition, which already binds `onInput` to activity, binds `onResize` to a new `{ kind: 'resize' }` activity signal. The reducer records `lastResizeAt` only. It does not settle, acknowledge, or change the source. `applyRawOutput` skips raw output within the same 1 s window after `lastResizeAt` as after `lastUserInputAt`. This keeps the terminal-session boundary intact: the server, not a client, decides what counts as activity, and the PTY byte stream is unchanged. Alternative: suppress the resize window in the client. Rejected, because the server owns activity and other devices would still see the flash.

4. **The window is the existing 1 s raw-activity window.** A shell or TUI redraws for `SIGWINCH` immediately. Output that keeps arriving after 1 s is real work and counts.

## Risks / Trade-offs

- [A hidden terminal's PTY keeps an old size until it is shown, so a background process that formats for the width prints at the old width] → This was already the case for terminals whose tab is inactive (their body is not mounted). The PTY is corrected the moment the terminal is seen.
- [Real output that lands within 1 s of a resize is not counted] → It counts as soon as it continues past the window; brief output that coincides with a resize is the same trade already made for typing.
- [Tests that resize a window and then read a background terminal's grid] → CI runs the full e2e suite; any such test is fixed to bring the terminal forward first.

## Migration Plan

None. Both changes are behavioural and take effect on upgrade; rolling back restores the previous behaviour.

## Open Questions

None. No in-force ADR is affected.
