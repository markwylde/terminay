## 1. Command Bar

- [x] 1.1 `CommandBarDialog`: turn the `ESC` hint into a button named "Close command bar" that calls `onClose`, keeping its key-cap look — verified by E2E (a tap at phone width closes the bar and nothing runs) and by a wide-window click

## 2. Switcher

- [x] 2.1 `CompactSwitcher`: the rail's server control gets a `Servers` label and selected state, and selects a `SERVERS` rail key instead of opening the `server` sheet layer; delete that layer — verified by `compact-rail-drawer` E2E
- [x] 2.2 Servers panel: header, server rows, upgrade rows for attached connections only, no rename/forget, and Add connection as the create bar's wide control — verified by `compact-rail-drawer` and `server-upgrade` E2E
- [x] 2.3 Launcher folder picker: Open in disclosure, Filter folders field, listbox, no-match message, arrows and Enter, Escape collapsing only the picker — verified by `compact-rail-drawer` E2E with a dozen worktrees
- [x] 2.4 Update the suites that pressed the server control or folder chips — verified by `npm run test:e2e` on those files
- [x] 2.5 Extract the switcher's drawer shell into `CompactEdgeDrawer` and use it for the switcher — verified by the `compact-rail-drawer` E2E staying green

## 3. Compact section page kit

- [ ] 3.1 Remove the Home options panel: delete `HomeOptionsPanel`, `HomeSectionOptions` and every section's slot wrapping, the chrome row's `homeOptions` prop and filtered dot, and `App.tsx`'s panel state and routing; on a compact Home draw no sidebar toggle and make the shortcut and sidebar command do nothing — verified by typecheck and by E2E (no sidebar toggle on a compact Home; a project still has one)
- [ ] 3.2 `CompactEdgeDrawer` gains `edge="bottom"`: full width, `max-height: 80%`, rounded top, slide up, reduced motion — verified by E2E (sheet anchored to the bottom edge, no running animation under reduced motion)
- [ ] 3.3 `src/workspace/compact/`: `CompactHomeContext` and `useCompactHome`, `CompactSectionPage` (header, search mode, status tabs, applied row), `CompactRow`, `CompactGroupHeader`, `CompactChip`, `CompactEmpty`, `CompactSheet` and its building blocks — verified by the per-section E2E below and a unit test of the tab and applied-token logic
- [ ] 3.4 One drawer at a time: `compactDrawerEpoch` from `App.tsx`; the sheet closes when the switcher or Command Bar opens or the window widens — verified by E2E (sheet → switcher, sheet → Command Bar with focus in the bar, widening with a sheet open)

## 4. Sections

- [ ] 4.1 Tabs: tabs All/Needs you/Working/Done/Idle (+Untracked), rows grouped by project, sheet Layout and Untracked tabs, no Board — verified by `compact-section-pages` E2E
- [ ] 4.2 Workflows: own compact tab state, a stored multi-tone status filter shown as one token, progress rows, unrestorable rows, sheet Sort/Group/projects/Finished, one project token — verified by E2E (wide two-tone filter → phone token → wide still two tones)
- [ ] 4.3 Workflow detail page: back, eyebrow, progress, Open terminal, brief, step timeline, needs-you highlight, live updates, return to the list when the workflow is removed, scroll and focus restored on back — verified by E2E
- [ ] 4.4 Bots: New bot, tabs All/Needs you/Working/Stopped mapped to the filter chips, avatar rows, Needs you cards with the permission prompt on the owning connection (pending disables, failure keeps the card with an error, decided elsewhere removes it), engine card opening the sheet, build banner kept — verified by E2E and the `bots` suite
- [ ] 4.5 Automations: New automation, tabs All/Failing/Schedules/Events/Off, rows with the switch working in place, Terminals row, sheet only with several servers — verified by E2E and `automations-ui`
- [ ] 4.6 Recordings: tabs All/Today/This week/Problems, day groups, rows with a more control offering Delete recording, sheet with server and Refresh — verified by E2E
- [ ] 4.7 Pull Requests and Issues: scope tabs with counts keyed by scope, State, and repository (+ for more pages, none before a result, never fetching), rows, sheet State/Group/repository/Refresh, applied tokens, Show all empty state — verified by E2E

## 5. Verification

- [ ] 5.1 `e2e/compact-section-pages.spec.ts`: header, search, tabs and counts, tablist arrow keys, sheet open/close/focus/Escape/reduced motion, applied tokens, state across a tab round trip and the breakpoint, wide pages unchanged, no Home sidebar toggle and an inert shortcut and command on a compact Home with the wide Home sidebar choice preserved — verified by `npm run test:e2e`
- [ ] 5.2 A seeded screenshot run that populates every section with realistic rows (workflows via MCP, automations, recordings, a fake forge, fake bots) and captures each page, the sheet, search, and the workflow detail — verified by reviewing the screenshots
- [ ] 5.3 Update `home-sidebar`, `home-tabs`, `home-workflows`, `automations-ui`, `bots`, and `pixel` for the compact pages; delete `compact-home-options` — verified by `npm run test:e2e`
- [ ] 5.4 Typecheck, Biome, `openspec validate phone-review-fixes --strict`, and `openspec validate --all` pass — verified by running each
- [ ] 5.5 Pull request CI: read back every Gitea commit status on the PR head SHA and confirm each is `success` or `skipped` — verified with `tea` and the Gitea API, listing the final statuses
