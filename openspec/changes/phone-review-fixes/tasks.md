## 1. Command Bar

- [x] 1.1 `CommandBarDialog`: turn the `ESC` hint into a button named "Close command bar" that calls `onClose`, keeping its key-cap look — verified by `compact-home-options` E2E (tap at phone width closes the bar, nothing runs) and by a wide-window click

## 2. Switcher

- [x] 2.1 `CompactSwitcher`: the rail's server control gets a `Servers` label and selected state, and selects a `SERVERS` rail key instead of opening the `server` sheet layer; delete that layer — verified by `compact-rail-drawer` E2E (selecting Servers opens no menu and marks Servers selected; in edit mode it shows no grip)
- [x] 2.2 Servers panel: header, server rows (current checked, connecting hint, switch on choose, no-op on current), upgrade rows for attached connections only, no rename/forget, and Add connection as the create bar's wide control — verified by `compact-rail-drawer` and `server-upgrade` E2E
- [x] 2.3 Launcher folder picker: an Open in disclosure with a Filter folders field and listbox. Substring filter, a "no folders match" message, arrow keys and Enter, Escape collapses only the picker, choosing collapses back to launchers, and a single folder does not expand — verified by `compact-rail-drawer` E2E with a dozen worktrees, covering filter, no-match, Enter, and Escape
- [x] 2.4 Update the suites that pressed the server control or folder chips (`compact-rail-drawer`, `compact-rail-drawer-visual`, `compact-chrome-switcher`, `server-upgrade`) — verified by `npm run test:e2e` on those files

## 3. Home options panel

- [x] 3.1 Extract the switcher's drawer shell into `CompactEdgeDrawer` (left/right edge, scrim, slide-in, reduced motion, focus containment, Escape) and use it for the switcher — verified by the existing `compact-rail-drawer` E2E staying green
- [x] 3.2 `HomeOptionsPanel` with a `HomeSectionOptions` slot. It registers per Home tab id and the host reads only the tab in front. Wide renders inline; compact always portals into a closed, `inert` panel — verified by `compact-home-options` E2E with Workflows and Bots both open (the toggle follows the tab in front) and a bot detail tab (no toggle)
- [x] 3.3 `HomeWorkspace`/`HomeView`: pass `isCompact`, never show the Home sidebar while compact, and never read or write the remembered Home sidebar visibility while compact — verified by E2E: no section list after pressing the toggle on Home, and the wide sidebar choice survives a phone visit
- [x] 3.4 `App.tsx`: own the panel's open flag, route the trailing toggle, shortcut, and sidebar command to it on a compact Home, close it on tab change, leaving Home, leaving compact, and opening the switcher or Command Bar, show the filters-applied marker and name, and return focus to the toggle, the title block, or the page — verified by E2E for each closing route and each focus destination
- [x] 3.5 Move each section's controls into the slot with its `active` predicate: Tabs (`WorkspaceDashboard`), Automations (`AutomationPanels`), Workflows (`WorkflowsHome`, every option shown directly), Recordings (`SharedRecordingsLibraryPane`), Pull Requests and Issues (`ForgeViews`) — verified by E2E opening the panel on each of these seven sections, plus a wide-window check that every toolbar is still on the page
- [x] 3.6 On-page empty states with a clear control: a Recordings clear-search button, a Bots on-page clear, and a forge "Show all" reset — verified by E2E on Workflows and Recordings no-match states
- [x] 3.7 Bots compact presentation: one-row title with New bot, controls and `EngineSummary` in the slot, `NeedsYouList` below the list, compact gutters — verified by E2E and screenshots
- [x] 3.8 State survival: filters survive closing and reopening the panel, a tab round trip, and crossing the breakpoint — verified by E2E typing a Workflows filter, opening Bots, returning, and widening

## 4. Verification

- [x] 4.1 New `e2e/compact-home-options.spec.ts` covering the scenarios above, including reduced motion (no transform on open), with screenshots of the key states — verified by `npm run test:e2e`
- [x] 4.2 Typecheck, Biome, and `openspec validate phone-review-fixes --strict` pass — verified by running each
- [ ] 4.3 Pull request CI: read back every Gitea commit status on the PR head SHA and confirm each is `success` or `skipped` — verified with `tea`/the Gitea API, listing the final statuses
