## 1. Compact breakpoint as one observed source

- [x] 1.1 Derive a single `isCompactChrome` flag in `src/App.tsx` from the width already observed for project tab overflow, and thread it to the header, `ProjectTabList`, the connection control, and `ProjectWorkspace`. Verified by a `node --test scripts/compact-chrome-breakpoint.test.mjs` case asserting the flag flips at 640px and that one source feeds every consumer (no second media-query origin in the changed files).
- [x] 1.2 Hide the Dockview panel tab strip when the flag is set, leaving panel layout and Dockview state untouched. Verified by the same unit suite asserting the strip is absent at 640px and present at 641px, and by `npm run lint`.

## 2. Unified switcher model

- [x] 2.1 Build the switcher row model in `src/workspace/` from the existing composed project/terminal inventory: connection groups, project groups carrying the project's activity count badge, and terminal rows carrying `{ serverId, projectId, sessionId }` plus the shared `TerminalActivityOverviewItem` state. Verified by `node --test scripts/compact-switcher-model.test.mjs` covering grouping by connection then project, a single attached connection still producing its heading, and two servers holding the same project id staying separate.
- [x] 2.2 Implement the filter over terminal titles, project names, and connection names, keeping a whole group when its project or connection matches and dropping emptied groups. Verified by unit cases in the same suite for title match, project match, connection match, and the no-match result.
- [x] 2.3 Source the preview line from the existing per-session `TerminalContextReader` registry, taking the most recent non-empty buffer line, truncated to one line, and yielding no preview when this window holds no buffer for that session. Verified by unit cases asserting truncation, blank-line skipping, absent-reader → no preview, and that resolving a preview mutates no activity state.

## 3. Compact chrome row

- [x] 3.1 Render the compact row in `src/App.tsx` — application menu slot, file-explorer toggle, dashboard, breadcrumb, connection control — replacing the compact project switcher. Verified by `node --test scripts/compact-chrome-breakpoint.test.mjs` asserting control order and that the wide bar composition is byte-identical to today's.
- [x] 3.2 Implement the breadcrumb naming the active project and active terminal, truncating the project name first, with both segments opening the switcher. Verified by unit cases for truncation order and by an e2e assertion that pressing either segment opens the switcher and no other menu.
- [x] 3.3 Give the connection control its compact glyph presentation — exposure tone, reachability dot, no visible name, accessible name still naming the server — and make it open the switcher. Verified by unit cases on the compact presentation model and an e2e accessible-name assertion.
- [x] 3.4 Make switcher open state mutually exclusive with the remote and activity menus in `src/App.tsx`. Verified by a unit case asserting opening any one closes the other two.

## 4. Compact application menu across the host boundary

- [x] 4.1 Add the optional `renderCompactApplicationMenu` field to the host presentation type consumed by `ConnectedRendererWorkspace`, supplied only by the browser composition in `src/web/ConnectedWebRendererWorkspace.tsx`. Verified by `npm run typecheck:workspaces` and by `node --test scripts/browser-app-capability-boundary.test.mjs` extended to assert the shared tree gains no browser-only command and Desktop supplies nothing.
- [x] 4.2 Render the browser menu as a single control inside the compact row, grouping File, Edit, View, and Help under their labels with the same capability gating, and suppress the menu bar band below 640px. Verified by `scripts/browser-app-capability-boundary.test.mjs` asserting both variants read one menu definition, and by `scripts/compact-chrome-breakpoint.test.mjs` asserting the band is suppressed by the shell's stamped decision rather than a second width source. The Electron e2e host advertises native menus, so it renders no in-page menu to assert against.

## 5. Switcher surface

- [x] 5.1 Build the switcher component: sheet overlaying the workspace without changing terminal geometry, filter field, grouped rows with activity state and preview line, per-group new terminal, and New project / Add connection actions. Verified by e2e assertions that terminal geometry is unchanged while open and that every create action is present.
- [x] 5.2 Wire row activation through the existing composed-tab activation path so a row in a background project selects that project on its own server first. Verified by an e2e case activating a terminal in a background project on a second connection and asserting both the project and the terminal became active.
- [x] 5.4 Keep long-press project editing reachable at compact width by making the switcher's project heading the long-press target. Added during apply: hiding the project strip removed the only compact surface carrying that gesture, so the switcher had to take it rather than let the capability disappear. Verified by `scripts/compact-switcher-ui.test.mjs` asserting the heading is the target and by the updated `e2e/project-tabs.spec.ts` long-press cases.
- [x] 5.3 Implement dismissal by outside press and by Escape with focus returning to the opening control. Verified by e2e keyboard and pointer dismissal cases asserting the focused element afterwards.

## 6. Styling

- [x] 6.1 Add the compact row and switcher styles to `src/App.css` and the responsive workspace styles, keeping the row at 40px, icons narrowing before the breadcrumb truncates, and 44px minimum row targets in the sheet. Verified by an e2e case at 320px asserting no horizontal overflow of the chrome row and by `npm run lint`.

## 8. Touch-host layout stability

- [x] 8.1 Stop the focus zoom at the control: iOS ignores `user-scalable=no` (since iOS 10) and zooms whenever a focused control's computed type is under 16px, so the filter declares 16px and is scaled back to the sheet's 13.5px inside a wrapper that owns its layout box. Verified by `scripts/compact-chrome-breakpoint.test.mjs` asserting the declared size, the scale factor, the resulting rendered size, and that no document forbids user scaling; and by an e2e case asserting the chrome row does not move when the filter takes focus.
- [x] 8.2 Collapse the switcher filter to a search control that expands on demand, take no focus when the switcher opens, and clear the filter when it collapses. Verified by unit assertions that the sheet renders no field and nothing is autofocused, and by the e2e filter case opening the control before typing.
- [x] 8.3 Keep the filter's rendered type identical to the rest of the sheet rather than inflating it. Verified by a unit assertion that declared size times scale equals the sheet's 13.5px.

## 7. Verification

- [x] 7.1 Add the compact e2e coverage as its own spec file and register it the way sibling suites are. Verified by the new spec passing under `npm run test:e2e` in the Docker harness, never Playwright on the host.
- [x] 7.5 Register the new suites in the `smoke` script so CI actually runs them; `scripts/browser-app-capability-boundary.test.mjs` was unreferenced by any CI script and is registered alongside them. Verified by the suites appearing in `npm run test:ci`'s chain and passing there.
- [x] 7.2 Run `npm run lint`, `npm run typecheck:workspaces`, and the new and touched `node --test` suites locally. Verified by all three completing clean.
- [x] 7.3 Run `openspec validate --all`. Verified by a clean report.
- [ ] 7.4 Open the pull request against `origin` (Gitea) with `tea`, then read back every commit status on the head SHA until each is `success` or `skipped`. Verified by the status list itself, not by the pull request existing.
