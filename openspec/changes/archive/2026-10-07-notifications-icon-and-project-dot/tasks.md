## 1. Project dot

- [x] 1.1 Rework `ProjectTabActivityBadge` to render `AgentStatusIndicator` (small) from the summarised project state, with its own element class and the "N terminals, state" accessible label and no visible number. Verified by a unit test covering each state, the hidden-at-zero case, and the label.
- [x] 1.2 Move the dot before the title in both project tab render paths in `ProjectTabList.tsx`, and before the project name in `ProjectSwitcherMenu.tsx` and `CompactSwitcher.tsx`. Verified by component tests asserting DOM order relative to the title.
- [x] 1.3 Remove the count-badge CSS for the project tab from `src/App.css` and add spacing for the leading dot so the title does not shift vertically. Verified by comparing computed dot size against a terminal tab dot in an e2e assertion.
- [x] 1.4 Keep the overflow layout re-evaluating when a dot appears or disappears. Verified by the existing overflow e2e scenario, updated to the dot locator.

## 2. Notifications model

- [x] 2.1 Change `buildTerminalActivityOverview` to return `notifications` (attention then finished) and `working` lists plus the notification count. Verified by unit tests for ordering, the count excluding working, and multi-server keys.
- [x] 2.2 Trim `activityCountBadge.ts` to what the header count and the dot label still use. Verified by `npm run typecheck` and the unit suite passing with no unused exports reported by Biome.

## 3. Notifications control

- [x] 3.1 Reshape `TerminalActivityOverview` into the Notifications control: always-rendered bell button named Notifications, single red fixed-circle count hidden at zero, 99+ cap. Verified by component tests for zero, one, two-digit, and capped counts.
- [x] 3.2 Render the notification list with its empty state; working terminals are not listed. Verified by component tests for each combination in the spec scenarios.
- [x] 3.3 Add the per-row dismiss control and **Clear all**, absent on working rows and when there are no notifications; the list stays open after a dismissal. Verified by component tests asserting the callbacks fired and the controls' presence.
- [x] 3.4 Update `src/App.tsx` to render the control unconditionally and drop the close-when-empty effect. Verified by an e2e check that the icon is present on a fresh workspace and opens to the empty state.
- [x] 3.5 Style the control and list in `src/App.css`, removing the three-pill styles. Verified by a screenshot of the header in the zero, counted, and open states reviewed against the request.

## 4. Dismissal

- [x] 4.1 Expose `acknowledgeTerminal(sessionId)` on the project workspace handle, calling the activity controller's existing `markViewed`. Verified by a unit test that it reports the server acknowledgement and clears the local record without changing selection.
- [x] 4.2 Wire dismiss and **Clear all** in `src/App.tsx`, resolving the workspace by server and project. Verified by an e2e scenario: dismissing a background project's notification clears its terminal dot, project dot, and the header number while the active project is unchanged.
- [x] 4.3 Confirm row activation acknowledges like selecting the tab, correcting it if not. Verified by an e2e scenario activating a finished row and asserting the notification is gone.
- [ ] 4.4 Cover two attached servers holding the same project id. Verified by a test that dismissal acknowledges only on the owning server.

## 5. Existing tests and validation

- [x] 5.1 Update locators and expectations in `e2e/project-tabs.spec.ts`, `e2e/terminal-signals.spec.ts`, and `e2e/terminal.spec.ts` from count badges and pills to the dot and the Notifications count. Verified by `npm run test:e2e` passing.
- [x] 5.2 Run lint, typecheck, and unit tests. Verified by each command exiting zero.
- [x] 5.3 Run `openspec validate --all`. Verified by it reporting no errors.
- [x] 5.4 Open the pull request on `origin` with `tea` and read back every commit status. Verified by every status being `success` or `skipped`.

## 6. Stale interaction acknowledgement

- [x] 6.1 Acknowledge arriving finished or attention activity only for the terminal that is both last interacted with and focused, and drop the interaction when focus moves to another terminal. Verified by `scripts/terminal-activity-acknowledgement.test.mjs` and an e2e scenario that finishes work in a terminal after a second terminal is opened.

## 7. Notification rows

- [x] 7.1 Carry the time a terminal or agent entered its state through the inventory to the list items, and render each row as a headline, the terminal and project, and a relative age, newest first. Verified by `scripts/notification-text.test.mjs` and the row tests in `scripts/notifications-control.test.mjs`.
