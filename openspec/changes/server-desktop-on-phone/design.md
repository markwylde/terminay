## Context

`src/App.tsx` renders one of two headers. Wide windows get the full header, whose `.header-actions` holds `ServerDesktopButton` and its dropdown. When `useCompactChrome` reports phone width, the header is `CompactChromeRow` instead, and navigation moves into `CompactSwitcher`, a drawer with a rail of places (Servers, Home, projects). Nothing in the compact path mentions the desktop.

Opening a desktop tab is `serverDesktopPlaces.openHere()`: it adds an entry to the device-local `desktopTabs` store (or a Home tab), and the folder's Dockview adds a `serverDesktop` panel with params `{ tabId, serverId, place, … }`. The desktop tab draws every server state itself, and passes `compact` to the viewer bar.

The drawer's rows come from the workspace inventory, built from Dockview panels by `buildProjectInventoryEntries`. Its `panelKind()` recognises terminals, files, folders, and forge items by their params and falls back to `'terminal'`. A desktop panel has none of those params, so it is inventoried as a terminal without a session. Consequences seen in the code:

- `activateCompactSwitcherPanel` returns early for `'terminal'` rows after the dashboard path, which activates by session. A desktop row has no session, so nothing comes to the front.
- The row menu offers Rename and Move to folder, which dispatch terminal events.
- The row counts as an idle terminal in project summaries and on the dashboard.

Close already works: a row without a session dispatches `terminay-request-close-file`, which closes by panel id, and the folder's `onDidRemovePanel` handler forgets the tab.

In-force ADRs that bear on this: ADR-0125 (compact drawers are navigation surfaces), ADR-0146 (the desktop is a server-wide trust domain with one controlling client), ADR-0147 (shared remote-desktop package).

## Goals / Non-Goals

**Goals:**

- A phone can open the server desktop, find the tab again, and close it, in a project and in Home.
- One implementation of opening a tab, shared with the wide header.

**Non-Goals:**

- A dropdown or scaled preview at phone width.
- Changing the viewer, its touch input, or its compact bar.
- A desktop entry in the compact row itself, the command bar, or Home's section list.
- Listing Home's desktop tabs in the drawer. Home on a phone shows the tab in front, and D4 gives a desktop tab its own way out.
- Archiving in this pull request. `add-server-desktop` introduces the `server-desktop` spec and is not archived; this change's MODIFIED requirement can only fold in after it, so both archive later, that one first.

## Decisions

### D1. The entry is a row in the drawer's Servers panel

`CompactSwitcher` takes an optional `onShowDesktop`. When present, `ServersPanel` draws a full-width Show Desktop row (the `Monitor` glyph the header uses) beneath the server list, outside the radiogroup. `App.tsx` passes it only when `serverDesktopClient` is defined, and the handler closes the switcher and calls `serverDesktopPlaces.openHere()`.

*Why:* the wide control "sits beside the server menu", and at phone width the Servers panel is the server menu. The desktop belongs to the server, not to a project, so it does not belong in a project's tree or its create dropup.

*Alternatives:* a button in `CompactChromeRow` was rejected: `simplify-phone-header` pared that row down and it has no spare width. A command-bar entry alone was rejected as undiscoverable.

*Boundary:* none crossed. The row is renderer UI over the existing `server.desktop.*` client; authority stays the server's check on each operation (ADR-0146). Hiding the row for a server without the capability is presentation, not enforcement.

### D2. No dropdown at phone width; the tab is the surface

The row opens a tab directly. The dropdown is a glance for a wide window; a 360px-wide scaled copy of a desktop is not useful, and the tab already renders `needs-setup`, `setting-up`, `off`, `unsupported`, and `failed`.

*Consequence:* opening a tab makes it the stream's sized place, so the desktop takes the phone's size while the tab is on screen and the client is controlling. That is the existing rule for any desktop tab, and a view-only client scales instead.

*Alternative:* showing the dropdown's content as a bottom sheet first. Rejected: one more step before the only useful action.

### D3. Desktop tabs get an inventory kind

`WorkspaceInventoryPanelKind` gains `'server-desktop'`. `InventoryPanelParams` gains the desktop panel's `tabId`, and `panelKind()` returns the new kind for a panel whose id starts with `server-desktop-` and whose params carry a `tabId` — the same test the folder workspace already uses to recognise its desktop panels. The entry keeps the panel's own title, which the tab sets to `Desktop · <server label>`; `Desktop` is only the fallback before the tab has named itself.

Every consumer that switches on the kind handles it as a non-terminal: the drawer row (no workflow line, no Rename or Move; Close only on the current server, as the compact switcher contract already requires of every row), `activateCompactSwitcherPanel` (already activates non-terminals by panel id), summaries (already count only terminals), the dashboard's `KIND_ICON`/`KIND_LABEL` maps (`Monitor`, `Desktop`), and the Folders tree's viewer kinds. The Tabs dashboard resolves a desktop row to its panel, not just its project, so choosing the row brings the tab to the front as a terminal row does; the row is re-checked against the inventory at click time like any other.

The dashboard activation resolver also recognises a desktop's panel id without requiring a terminal session. Its existing activation path selects the folder and focuses that panel; the drawer shares this path for desktops. Stale desktop rows are rejected against the current project inventory before activation.

*Why here:* the mis-kind exists at every width, but only at phone width is the drawer the sole route back to a tab, so the entry in D1 is not usable without it.

*Alternative:* special-casing desktop rows in the drawer only. Rejected: the dashboard and Folders tree read the same inventory and would keep calling it a terminal.

*Boundary:* the inventory is renderer state built from this window's own panels. It is not sent to the server and grants nothing.

### D4. A Home desktop tab carries its own close control at phone width

Home's tab host tells `renderServerDesktop` when Home is compact, and `ServerDesktopTabView` then draws a slim header above its content: a back control and the tab's title. The control calls the `close` the host already passes, which closes the tab and brings the previous one forward. The header is drawn in every branch of the tab (another server, not running, ready), because the tab's own menu exists only while the desktop is `ready` and a tab opened during setup must still close. A project's desktop tab draws no header: the compact row already names the tab in front, and its drawer row closes it.

*Why:* `workspace-dashboard` requires every Home tab that is not a section to offer a control that closes it, because Home on a phone draws no tab strip and the drawer does not list Home's tabs. Without this a desktop tab opened from Home could never be closed on a phone, and each press of Show Desktop would add another.

*Alternatives:* a Close tab entry in the tab's menu, rejected because the menu is absent until the desktop is `ready`. Listing Home tabs in the drawer, rejected as a much larger change to the drawer's Home panel, which lists sections.

*Boundary:* none crossed; closing a tab is device-local view state and leaves the server's desktop running.

### D5. Narrowing closes the dropdown

`isServerDesktopOpen` is cleared when `isCompactChrome` becomes true. The header that holds the dropdown unmounts at phone width, so today the flag survives and the dropdown reappears when the window widens.

### D6. The E2E drives the production workspace

`e2e/server-desktop-browser.spec.ts` mounts only the button and dropdown, so it cannot show the drawer, Dockview, or `App.tsx` wiring. The phone cases go in `e2e/server-desktop.spec.ts`, which runs Terminay Desktop against a real standalone server reporting `needs-setup`, with the window set to phone bounds the way `e2e/compact-rail-drawer.spec.ts` does.

## Risks / Trade-offs

- [A consumer of the kind is missed and falls into a terminal branch] → the kind is a closed union, so record-typed maps fail to compile; the remaining `=== 'terminal'` checks already exclude it. Covered by typecheck and the unit tests.
- [A phone that controls the desktop resizes it to phone size for everyone] → existing behaviour for any controlling client's tab; a phone that only wants to watch does not take control.
- [`add-server-desktop` is unarchived, so the `server-desktop` main spec does not exist yet] and `openspec validate` notes that archive would refuse this delta today → the order is fixed: `add-server-desktop` archives first. The MODIFIED block copies that requirement whole, so nothing is lost when it folds in.
- [The E2E server only reaches `needs-setup`, so the `ready` viewer is not exercised at phone width] → the entry, tab, drawer row, and close paths do not depend on the state; the viewer itself is unchanged and out of scope.

## Open Questions

None.
