## Context

The compact chrome collapsed three bands — the application menu, the project
strip, the panel tab strip — into one row of five controls plus a unified
switcher. That collapse was the right call for a 40px row on a phone, but it
removed two surfaces that were the only host of a gesture:

- The Dockview panel tab strip carried double-click and long-press to the tab
  editor (`DockTabChrome` → `onDoubleClick` → the `terminay-edit-terminal`
  event). `.workspace--compact-chrome .dv-tabs-and-actions-container` sets
  `display: none`, so at compact width nothing dispatches that event.
- The project strip carried long-press to the project editor. The switcher's
  project heading took that gesture over, so project editing survived — but
  only as a gesture, with nothing naming it.

The Command Bar is the surface that already exists to invoke a command with no
chrome, and it would answer all of this. It cannot: `open-command-bar` is
dispatched only from the `CmdOrCtrl+L` window listener in `src/App.tsx` and
from the Desktop View menu in `electron/main.ts`, and a browser host renders no
native menu. `setIsMacroLauncherOpen(true)` has exactly one caller.

So a touch host has both a hole in its command set and no fallback to reach
through.

## Goals / Non-Goals

**Goals:**

- Every action the compact collapse orphaned is reachable at compact width,
  on a host with no keyboard, by something that names itself.
- The compact row grows by one control, not by one per orphaned action.
- Restore the long press the user reaches for, on the surface that replaced the
  one it used to live on.

**Non-Goals:**

- Re-introducing the panel tab strip at compact width.
- Changing the wide-bar chrome, the switcher's model, or the Command Bar's own
  presentation and search behaviour.
- New accelerators for the editing commands. They join the command model with
  no default binding; a user who wants one rebinds them.

## Decisions

**Promote the editors to commands rather than adding controls.** `show-dashboard`
already establishes the shape: a first-class `AppCommand` is simultaneously a
Command Bar entry, a Desktop menu item, a browser in-page menu item, and a
rebindable shortcut. Adding `edit-active-tab` and `edit-active-project` to
`AppCommand` gets four reach surfaces from one change, and it is the only option
that scales — the next action the chrome drops is then a command, not a sixth
icon. The alternative, a control per action in the compact row, refills the row
the collapse emptied and was rejected on that ground.

**One new control in the compact row, and it is the Command Bar.** A row that
reaches a command set needs exactly one door to it. The control sits between
the dashboard control and the breadcrumb, keeping the row's existing reading —
leading cluster acts, trailing cluster says where you are and what you are
connected to — and the breadcrumb, which already truncates, absorbs its width.
It invokes `executeCommandOnActiveProject('open-command-bar')`, the path the
accelerator and the Desktop menu already take, so there is one dispatch route
and no second definition of what the command means.

**The control is disabled with no project in front, not hidden.** That dispatch
resolves `workspaceRefs.current.get(activeProjectId)` and returns a resolved
promise when the dashboard is selected, so the command is already a silent
no-op there. A control that looks live and does nothing is worse than one that
says it is unavailable; the wide bar's file-explorer toggle already takes the
`disabled={!activeProject}` form for the same reason. The same rule gives the
two editing commands their "nothing in front" behaviour.

**The switcher terminal row takes the long press.** The switcher is where a user
now goes to find a terminal, and its project heading already carries long-press
editing, so the terminal row carrying it too is the consistent reading rather
than a new idiom. Short press keeps activating the terminal, exactly as the
heading's short press stays inert and its long press edits.

**No boundary is crossed.** Every change is renderer presentation over the
existing command model. `renderCompactApplicationMenu` stays the only host-
supplied menu seam, the browser menu keeps dispatching through the shared
command vocabulary, and the editors keep opening through the host's existing
auxiliary-route presentation — native modal on Desktop, in-page `edit-tab`
route on web. No new privileged call, no new protocol message, no server state.

## Risks / Trade-offs

- **A sixth control narrows the breadcrumb** → The breadcrumb already truncates
  the project name before the terminal title, so the segment a user needs to
  read survives. Verified at 320px against horizontal overflow, the same bound
  the compact row already holds.
- **Two more commands enlarge the Command Bar's built-in list** → They are
  scoped: unavailable with nothing in front, so they drop out of the list
  exactly where they would mislead.
- **The delta modifies a requirement another unarchived change also modifies**
  → `compact-unified-switcher` is implemented and merged; this delta is written
  against its text and should land after it archives. Landing first would lose
  its compact-row wording at archive time.
- **Promoting editors to commands makes them rebindable and so bindable to a
  key that already means something** → The shortcut settings surface already
  arbitrates conflicts for every command; these join on the same terms and ship
  with no default binding, so nothing changes until a user asks for it.

## Open Questions

None. No in-force ADR constrains this change and none needs revisiting: it adds
no boundary, no dependency, and no pattern beyond the command model
`show-dashboard` already established.
