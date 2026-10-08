## 1. Spike: state retention

- [x] 1.1 Confirm that Home panels added with `renderer: 'always'`, in a Home kept mounted but hidden while a project is selected, keep what was typed. Verified by: `e2e/home-tabs.spec.ts` "an unsaved automation is still there after a visit to a project and to another tab" passes; no fallback was needed.

## 2. Home tab model

- [x] 2.1 Add `src/workspace/homeTabs.ts` with the descriptor union, id encode/parse, section-of-descriptor, and title derivation. Verified by: a new `scripts/home-tabs-model.test.mjs` covering round-trips, unknown ids, and section mapping passes.
- [x] 2.2 Add the stored-layout filter (drop unparseable ids, drop `automation-new:*`, fall back to the Home section tab) and the read/write helpers for `terminay.view.home-layout.v1` in `localViewState.ts`, reading `terminay.view.home-section.v1` once when no layout exists. Verified by: new cases in `scripts/local-view-state.test.mjs` for corrupt JSON, unavailable storage, stale ids, and the one-time section fallback pass.

## 3. Home workspace host

- [x] 3.1 Create `HomeWorkspace` with its own `DockviewReact`, component map, `HomeTab` tab component, `openHomeTab` / `requestCloseHomeTab` context, and layout save/restore; do not use the project lifecycle hooks. Verified by: `tsc --noEmit` passes and a grep shows no import of `useDockviewPanelLifecycle`, `useTerminalAdoptionController`, or `reconcileServerPanels` from Home code.
- [x] 3.2 Mount `HomeWorkspace` from `App` the first time Home is shown and keep it, hidden and inert, while a project is selected; queue tabs asked for before it exists. Verified by: the same e2e case leaves for a project, sees its terminal, and returns; `e2e/workspace-dashboard.spec.ts` "terminals keep running" passes.
- [x] 3.3 Turn the sidebar into a launcher: entries open or focus a section's tab, the current item derives from the active panel's section, and `data-terminay-home-view` reports it. Verified by: `e2e/home-sidebar.spec.ts` "first visit…" (arrow keys move focus, Enter opens, a section never opens twice) and "the tabs open in Home, and the one in front, are remembered" pass.
- [x] 3.4 Add the empty state shown when no Home tab is open. Verified by: e2e closes the last tab, sees the three offers, and opens Automations from it.
- [x] 3.5 Remove `.home-band`, style Home's tab strip with the project strip rules and the neutral Home colour, and add the Home tab chip. Home's strip declares no window-drag region, so no macOS drag rule changed. Verified by: a screenshot walk-through of the running app in Docker (strip, chips, unsaved mark, split) was reviewed, and `e2e/home-sidebar.spec.ts` asserts the Home control is active over a visible Home tab strip.
- [x] 3.6 In compact chrome, maximise the active group and restore on widening; give non-section tabs a header close control. Verified by: `e2e/home-tabs.spec.ts` "a compact Home shows the tab in front and gives each opened tab a way back" passes at 600px.

## 4. Automations as tabs

- [x] 4.1 Split `AutomationsSection` into `AutomationsListPanel`, `AutomationDetailPanel`, `AutomationEditorPanel`, `AutomationRunPanel`, and `AutomationTerminalPanel` (`AutomationPanels.tsx`), each given the `useServerAutomations` projection and its tab host; remove the `Page` state machine. Verified by: `tsc --noEmit` passes and `e2e/automations-ui.spec.ts` passes with navigation steps updated to tabs.
- [x] 4.2 Route New automation, Duplicate, row activation, Edit, run activation, Run now, and terminal activation through the tab host with the singleton rules. Verified by: `e2e/home-tabs.spec.ts` "several drafts are open at once, and an automation has one tab" passes.
- [x] 4.3 Save closes the editor tab and focuses the automation's tab; a refused save keeps the tab and shows the reason; `AutomationEditor` no longer re-seeds when `initial` changes. Verified by: the same e2e case, and `e2e/automations-ui.spec.ts` "the server's refusal is shown beside the form" pass.
- [x] 4.4 Add dirty tracking, the unsaved mark on the tab, and the discard prompt on the close control, Cancel, and the keyboard close. Verified by: `e2e/home-tabs.spec.ts` "closing a tab with unsaved edits asks first, and one without does not" passes.
- [x] 4.5 Close tabs for deleted automations, removed runs, closed terminals, and detached connections, with a notice when unsaved edits are dropped; a tab whose thing is merely not listed yet asks the server again before it is treated as gone. Verified by: `e2e/home-tabs.spec.ts` "deleting an automation closes its tabs and says which edits went with it" and the restored stale tab in "Home restores its tabs…" pass. The deletion is made on the same client; the tabs react to the server's change event either way.
- [x] 4.6 Host `AutomationTerminalView` in `AutomationTerminalPanel` with its inner strip hidden and drag-and-drop disabled. Verified by: `e2e/automations-ui.spec.ts` "a kept run terminal is shown in Automations and never as a project" passes; the `@heavy` worker-terminal case in `e2e/automations.spec.ts` is CI's.
- [x] 4.7 Replace `automationsFocus` with opening Home tabs from the overview widgets and the Command Bar. The missed-run notice has no navigation and is unchanged. Verified by: `e2e/automations-ui.spec.ts` "run now … and the overview leads back to it" passes.

## 5. The draft survives

- [x] 5.1 Add the regression test for the reported problem. Verified by: `e2e/home-tabs.spec.ts` "an unsaved automation is still there after a visit to a project and to another tab" passes.

## 6. Command Bar

- [x] 6.1 Move the Command Bar dialog, navigation, and scoring into `src/workspace/CommandBar.tsx`, drawn by the project with its commands and by the workspace view with its own. Verified by: `e2e/app.spec.ts` passes unchanged.
- [x] 6.2 Append places from `searchHome` for a non-empty query, grouped after commands and macros, naming the server when more than one is attached. Verified by: `e2e/home-sidebar.spec.ts` "Home opens into a tab strip, and the Command Bar goes to any tab or section" and `e2e/home-tabs.spec.ts` "the Command Bar finds an automation from a project…" pass; `scripts/home-search-model.test.mjs` still passes.
- [x] 6.3 Answer `open-command-bar` from the workspace view whenever Home is selected or the window holds no project, listing no command that needs a project; enable the compact control on Home. Verified by: `e2e/compact-chrome-switcher.spec.ts` "the command bar opens on Home, without a project in front", the no-project case in `e2e/project-tabs.spec.ts`, and `scripts/compact-chrome-breakpoint.test.mjs` pass.
- [x] 6.4 Delete `HomeSearch.tsx`, its CSS, and the `/` listener; show the Command Bar shortcut in the Home empty state. Verified by: no `home-search` remains in `src` or `e2e`, and `e2e/home-sidebar.spec.ts` "closing every tab leaves an empty Home that offers the sections" passes.

## 7. Persistence

- [x] 7.1 Save the arrangement on layout and active-tab change and restore it on mount. Verified by: `e2e/home-tabs.spec.ts` "Home restores its tabs side by side, and leaves out what no longer exists" passes, covering a split, a stale id, a draft, and an unreadable document.

## 8. Verification and delivery

- [x] 8.1 Run `openspec validate --all`, `tsc --noEmit`, `npm run lint`, and the `node --test` suites of the smoke gate. Verified by: all pass locally (the two packaged-artifact tests need `build:app` first and are left to CI).
- [x] 8.2 Run the Electron e2e suites that visit Home through `npm run test:e2e` (Docker): `home-sidebar`, `home-tabs`, `automations-ui`, `workspace-dashboard`, `project-tabs`, `compact-chrome-switcher`, `app`. Verified by: they pass locally; the full sharded suite is CI's.
- [x] 8.3 Drive the real app: create a draft, leave to a project and return, split an automation beside its run, relaunch, search from the Command Bar, narrow to phone width. Verified by: a screenshot walk-through taken from the app running in the e2e container was reviewed.
- [x] 8.4 Open the pull request on `origin` (Gitea) with `tea`. Verified by: every commit status on the head SHA reads `success` or `skipped`.
- [x] 8.5 Archive after `compact-unified-switcher` and `compact-command-bar-entry`. Verified by: `openspec validate --all` passes and the main specs carry this change's requirement text.
