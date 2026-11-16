## 1. Model

- [x] 1.1 Add `ForgeItemTarget`, `readForgeItemTarget`, the placeholder and loaded tab titles, and `createForgeClickIntent` (250 ms, keyboard immediate, third click ignored) to `src/forge/forgeModel.ts`. Verify: `src/forge/forgeModel.test.ts` covers single, double, triple, keyboard, and cancelled clicks, the titles, and malformed targets.
- [x] 1.2 Add the `forge-item` Home tab descriptor to `src/workspace/homeTabs.ts`, with an escaped id, its section by kind, and a placeholder title. Verify: `src/workspace/homeTabs.test.ts` round-trips an id with a port in its origin and rejects a bad kind or number.

## 2. Views

- [x] 2.1 Give `ForgeRow` and `ForgeListPane` a double-click `onOpen`, `ForgeSidebarRow` an `onOpen` behind the click intent, and `ForgeDetailPane` an Open in tab action shown only when given. Verify: `scripts/forge-ui.test.mjs` checks Open in tab is absent without a handler and present with one.
- [x] 2.2 Add `src/forge/ForgeItemTab.tsx`: `ForgeItemView` (detail, loading, failure with Retry, title once loaded), the folder Dockview panel and tab chip, and `ForgeTabContext`. Verify: `scripts/forge-ui.test.mjs` renders an item tab with no forge client and finds its item and reason.

## 3. Wiring

- [x] 3.1 In `ProjectWorkspace`, register the `forgeItem` component and tab, provide `ForgeTabContext`, and open or bring forward an item tab in the active group from the Git tab's double click and Open in tab. Verify: `tsc` passes; the running-app check is 4.3.
- [x] 3.2 In Home, render `forge-item` tabs through `renderForgeItem`, open them from `ForgeHomeSection`'s double click and Open in tab, and refuse a tab of another server. Verify: `tsc` passes; the running-app check is 4.3.
- [x] 3.3 Inventory a folder's item tab as `forge-item`, with an icon and label in the Tabs dashboard and Folders tree. Verify: `scripts/workspace-inventory.test.mjs` inventories an item tab as `forge-item`, not a terminal.

## 4. Verification

- [x] 4.1 `npx biome lint` on the changed files, `tsc`, `npm run test:forge-ui`, and the Home tabs, inventory, dashboard, and switcher model suites pass.
- [ ] 4.2 Pull request CI on Gitea reports every status `success` or `skipped`.
- [ ] 4.3 In the running app, with a Gitea account: double-click an issue on Home and in a worktree's Git tab, confirm the tab opens in the right place, a second double click brings it forward, a single click in the Git tab still selects Home, and Open in tab works on a phone-width window.
- [x] 4.4 Extend `e2e/forge-pull-requests-and-issues.spec.ts`: a Home row double click opens one Home tab per item, Open in tab opens one, and a Git tab row double click opens one tab in the selected folder without selecting Home and lists it in the Folders tree. Verify: `npm run test:e2e -- e2e/forge-pull-requests-and-issues.spec.ts` passes.
