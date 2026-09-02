## Why

The Desktop compatibility transfer path copied renderer presentation state into
the destination window, gave the copy a synthetic project id, and then ran the
ordinary project-close path in the source. Both renderers also flattened every
server workspace view into their tab bars. A torn-off project could therefore
appear beside unrelated projects, lose its canonical scope, or lose its live
terminal presentation after reconciliation.

## What Changes

- Each native project-host window binds to exactly one canonical server-owned
  workspace view, and renders only that view's ordered projects.
- The bound view id is carried through Desktop window creation and the preload
  boundary without exposing generic workspace authority.
- **BREAKING** Tear-off creates a destination view and commits `project.move`,
  preserving project, panel, and terminal session ids. Renderer-local project
  copying, synthetic project ids, and the post-transfer `project.close` call are
  removed from the canonical path.
- A failed destination creation or move leaves the source project usable and
  does not strand an empty view.
- The ready destination window is activated so its first terminal-control click
  is not consumed by window activation.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `workspace-and-project-tabs`: project tear-off becomes an identity-preserving
  move between canonical workspace views rather than a copy-and-close.
- `server-owned-workspace-state`: one canonical workspace view binds to one
  native project-host window.

## Impact

Desktop window creation and the preload boundary, the renderer project tab bar
and its view filtering, the tear-off controller, and the `project.move` command
path. Verified through Docker end-to-end coverage including a real
pointer-driven tear-off.
