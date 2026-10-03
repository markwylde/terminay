## Why

Moving a terminal into another project takes a right-click, a submenu, and a pick from a list, even though the destination project tab is already on screen a few pixels above the terminal tab. Terminal tabs are already draggable and project tabs are already the obvious target, so dropping one on the other is the gesture users reach for first — and today it does nothing.

## What Changes

- A terminal tab dragged from the active project's tab strip can be dropped onto another project's tab in the project bar. The drop moves that terminal into that project with exactly the outcome of **Move to project → <project>**: the terminal keeps its session, scrollback, title, colour, and recording state, the target project becomes active, and the moved terminal lands focused.
- While a terminal tab is dragged over the project bar, a project tab that would accept the drop is visibly marked as the drop target. Tabs that would not accept it show no drop affordance and ignore the drop.
- A project tab accepts the drop only when the context menu would list that project: a ready project on the same server as the dragged terminal, other than the terminal's own project. Pending, failed, and inert tabs, the Home control, and the `+` and connection controls are never drop targets.
- The context-menu path is unchanged and stays the route for projects that are not visible as tabs (overflowed behind the switcher, or the compact switcher layout).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-and-project-tabs`: adds a requirement that a terminal tab can be dropped on a visible project tab to move the terminal into that project, with the same eligibility and outcome as the context-menu move.

## Impact

- Renderer only: `src/workspace/ProjectTabList.tsx` (drop targets and their affordance), `src/App.tsx` (wiring the drop to the existing `moveTerminalToProject`), the Dockview drag bookkeeping in `src/workspace/useTerminalDockviewWindowController.ts`, and project bar styles.
- No protocol, server, preload, or Electron main-process change. The move runs through the existing export/adopt path, so the server-side project boundary and same-server rule are enforced exactly as they are for the context menu.
- New unit coverage for drop eligibility and an end-to-end case in `e2e/terminal.spec.ts`.
