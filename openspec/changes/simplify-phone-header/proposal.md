## Why

The phone header carries eight controls, and most of them are now
duplicates. The application menu, Home, and the server glyph each open
something the switcher already holds: its rail has Home and the server
control, and the server glyph opens the very same switcher as the title
block. On a 390px screen the duplicates squeeze the title block, which is the
one control that says where the user is. The sidebar toggle is also drawn as a
left panel at the left end of the row while it opens the project sidebar,
which is the right-hand column on every wider window.

## What Changes

- The compact chrome row holds, in order: Command Bar, title block,
  Notifications, Pixel's dock while Pixel is on, and the sidebar toggle at the
  trailing end, drawn as a right-hand panel.
- **BREAKING** (presentation only): the row loses its application menu
  control, its Home control, and its connection control. Home and the server
  menu stay in the switcher's rail.
- The title block always carries the server-unreachable and upgrade-available
  warnings, which the connection glyph used to carry when Pixel was off.
- A browser host's application menu moves into the switcher as a menu bar
  across its top, named Terminay, Edit, View, and Help as on a wide window,
  scrolling sideways when it does not fit. A Windows Desktop window shows its
  menu button there instead.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-and-project-tabs`: the compact row's controls and order; the
  switcher opens only from the title block and carries the application menu.
- `workspace-dashboard`: the Home control is no longer drawn in the compact
  row.
- `connections-and-client-hosts`: the compact application menu lives in the
  switcher.
- `pixel-pet`: Pixel's compact dock sits before the sidebar toggle.

## Impact

- `src/workspace/CompactChromeRow.tsx`, `src/workspace/CompactSwitcher.tsx`
  and its CSS, `src/web/ConnectedWebRendererWorkspace.tsx` and its CSS,
  `src/App.tsx`, `src/App.css`.
- E2E: `compact-chrome-switcher`, `compact-rail-drawer-visual`, `pixel`,
  `server-upgrade`, `project-tabs`.
