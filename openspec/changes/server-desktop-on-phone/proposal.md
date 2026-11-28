## Why

On a phone there is no way to open the server desktop. The Show Desktop control lives in the wide header, and at phone width that header is replaced by the compact row, which has no desktop entry. The server desktop contract says any client in Terminay may use the desktop, and the viewer already has phone-width touch targets, so the gap is only the way in.

A second gap sits behind it. At phone width the tab strip is hidden and the drawer is the only list of a project's tabs. A desktop tab has no kind of its own in the workspace inventory, so the drawer lists it as a terminal: it offers Rename, and choosing the row does not bring the tab to the front.

## What Changes

- The drawer's Servers panel gains a **Show Desktop** row for the server the window is attached to, shown only when that server advertises `server-desktop.v1`. Choosing it closes the drawer and opens a desktop tab in whatever the window is showing.
- At phone width there is no dropdown and no scaled preview. The desktop tab already shows every state the dropdown shows (setup, off, unsupported, failed), so the tab is the whole surface.
- Desktop tabs get their own kind in the workspace inventory. The drawer, the dashboard, and the Folders tree list one as a desktop under the tab's own title; its drawer row opens it by panel and offers Open and Close only.
- At phone width a desktop tab in Home shows a back control that closes it, in every state of the desktop, so a tab the drawer does not list can be closed without a tab strip.
- The header dropdown is scoped to wide windows, and a window that narrows to phone width closes an open dropdown instead of reopening it when widened.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `server-desktop`: modifies "Show Desktop sits beside the server menu" so the dropdown belongs to wide windows, and adds requirements for the entry at phone width, for how a desktop tab is listed among a project's tabs, and for closing one without a tab strip. The capability's spec is introduced by the unarchived change `add-server-desktop`, so that change archives first and this one after it.

## Impact

- Renderer only: `src/App.tsx` (wiring), `src/workspace/CompactSwitcher.tsx` and its CSS (the row), `src/workspace/serverDesktop/` and `HomeWorkspace.tsx` (the Home tab's close control), `src/workspace/workspaceInventory.ts` and the consumers of its panel kind (`dashboardRows.ts`, `WorkspaceDashboard.tsx`, `compactSwitcherModel.ts`, `FoldersTree.tsx`).
- No protocol, server, or authority change. The row uses the same desktop client and the same `openHere` path as the header control.
- Tests: unit tests for the inventory kind, and phone-width cases in `e2e/server-desktop.spec.ts`, which drives the production workspace against a real standalone server.
