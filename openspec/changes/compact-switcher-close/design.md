## Context

The compact chrome hid the Dockview panel tab strip and the project tab strip
below 640px. Those strips were the only visible close controls. The unified
switcher took over activation, creation, and (after `compact-command-bar-entry`)
long-press editing. Close was left as a deliberate scope edge: "available from
the terminal's own context menu". That menu lives on `TerminalTab`, which is not
drawn at this width. The terminal body menu is Copy/Paste. The Command Bar
command `close-active` exists but has no visible compact affordance of its own.

Close itself is already implemented: `ProjectWorkspace.requestClosePanel` owns
panel close-protection and `workspaceStore.closePanel`; `closeProject` owns
project close-protection. Every `ProjectWorkspace` stays mounted, so a close
event can target a background project's panel without a second close route.

In-force ADRs that constrain this: ADR-0018 (hosts are protocol-blind
presentation shells), ADR-0017 (work happens on the panel's own server),
ADR-0011 (renderer is untrusted; no new privileged call). Superseded and
treated as history: 0008 (by 0018), 0009 (by 0017).

## Goals / Non-Goals

**Goals:**

- A visible close control on every compact-switcher panel row and project
  heading, usable with a thumb.
- File and folder panels listed as rows, because they share the hidden strip.
- The same close-protection dialogs the tab strip already uses.
- No second close implementation.

**Non-Goals:**

- Re-drawing the panel or project tab strip at compact width.
- Swipe-to-dismiss, a context-menu rewrite, or a close button on the breadcrumb.
- Changing wide-layout tab chrome.
- Adding Close Terminal to the browser File menu (Desktop already has it; the
  Command Bar already searches `close-active`).

## Decisions

**Put close on the switcher row, as a sibling control.** A nested button inside
the row button is invalid HTML. Each row becomes a row container: the existing
activate/long-press target, plus a trailing close control with an accessible
name that includes the panel or project title. The close control stops
propagation so it cannot activate. Alternative considered: swipe-to-close —
more mobile-native, but Terminay has no swipe-to-delete idiom, it fights the
switcher's own scroll, and it is less discoverable than the `×` the hidden tab
already used.

**Keep the switcher open after close.** Closing is often several tabs in a row.
Dismissing on each close would force the breadcrumb open for every one.
Activation still dismisses, as it does today.

**List file and folder panels in the same list as terminals.** The dashboard
inventory already carries `terminal | file | folder`. The switcher currently
filters to terminals. Dropping that filter is the smallest way to make those
tabs closable without a second surface. Preview lines stay terminal-only.
Long-press still dispatches `terminay-edit-terminal` with the panel id, which
is the editor path file and folder tabs already use.

**Dispatch through the existing close paths, naming the panel.** Terminals
dispatch `terminay-request-close-terminal` with `{ panelId, sessionId }`. Files
and folders dispatch `terminay-request-close-file` with `{ panelId }` — that
listener already calls `requestClosePanel` for any panel id. Projects call
`closeComposedTab`, the same handler a project tab `×` uses. Cross-server rows
activate that server first when the window is not bound to it, matching create
and edit. No new protocol command. The project/window and terminal-session
boundaries stay the ones `requestClosePanel` and `closeProject` already
enforce.

**Do not close from the terminal body menu.** Copy/Paste there is the right
menu for buffer operations. Close is a tab operation and belongs on the
surface that replaced the tab.

## Risks / Trade-offs

- **A close control on every row crowds a 390px sheet.** → The control is a
  28px sibling matching the per-project `+`, not a new row. Titles still
  truncate.
- **Closing the last panel closes the project.** → Same as the tab strip; the
  last-panel rule in `requestClosePanel` is reused, not reimplemented.
- **A busy-terminal dialog appears over the switcher.** → Accepted: that is
  the existing close-protection UI. Keep Running leaves the row in place.
- **File rows without a preview look sparse next to terminals.** → Specified:
  no preview line, not an empty placeholder, matching terminals this window
  does not render.

## Migration Plan

Presentation-only. No persisted state, protocol version, or server change.
Rollback is reverting the change.

## Open Questions

- None blocking. No in-force ADR needs revisiting.
