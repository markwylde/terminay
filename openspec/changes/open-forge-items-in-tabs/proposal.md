## Why

A pull request or issue can only be read in the narrow detail pane beside its
list. To keep one open while looking at another, or to read one beside the
terminal working on it, a user has to leave Terminay for the forge. In a
project's Git tab it is worse: activating a row takes the user away to Home,
so the item cannot sit in the folder whose worktree is working on it
(issue #540).

## What Changes

- Double-clicking a row in Home's **Pull Requests** or **Issues** list opens
  that item as a Home tab of its own. A single click still selects it and
  shows it in the detail pane.
- Double-clicking a row in a project's Git tab opens the item as a tab in the
  selected folder (worktree), beside its terminals and files. A single click
  still does what it did, after waiting briefly to be sure it is not the first
  of two clicks.
- The detail pane gains an **Open in tab** action that does the same as a
  double click, for touch and keyboard users.
- An item tab shows the same detail and actions as the detail pane, is titled
  by number and title, and opening an item that is already open in that place
  brings its tab forward instead of opening a second one.
- Item tabs are device presentation, like file and folder tabs and the other
  Home tabs: the server does not store them, and closing one closes only the
  view.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pull-requests-and-issues`: adds requirements for opening an item as a tab
  from Home and from a project's Git tab, the Open in tab action, and what an
  item tab shows.

## Impact

- Renderer only: `src/forge/` (new `ForgeItemTab.tsx`, row double click,
  Open in tab), `src/workspace/HomeWorkspace.tsx` and `homeTabs.ts` (a
  `forge-item` Home tab), `src/App.tsx` (a folder's `forgeItem` Dockview
  component and the Home tab's content), and the workspace inventory, Tabs
  dashboard, and Folders tree, which learn the new tab kind.
- No preload, protocol, server, or stored workspace change.
