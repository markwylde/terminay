## 1. Shared badge formatting

- [x] 1.1 Add a small pure helper (for example `src/workspace/activityCountBadge.ts`) that formats a count (`99+` above 99), returns its digit class, and resolves the highest-priority badge state (attention over recent over unviewed) from a list of `TerminalActivityOverviewItem`. Verified by Vitest unit tests covering 1, 12, 99, 100, and mixed-state inputs.

## 2. Circular header badges

- [x] 2.1 Update `TerminalActivityOverview.tsx` so each pill renders the formatted count and carries `data-digits`. Verified by existing e2e assertions on `.terminal-activity-pill--unviewed` and `--attention` text still passing.
- [x] 2.2 Replace the `.terminal-activity-pill` geometry in `src/App.css` with a shared fixed 18px circle rule (no padding, `border-radius: 50%`, `line-height: 1`) and digit-stepped font sizes. Verified by a screenshot showing width equal to height with `1`, `12`, and `99+` and the text visually centred at 2x.

## 3. Per-project counts in App

- [x] 3.1 In `App.tsx`, derive a memoised `activityByProject` record from `terminalActivityItemsByProject` using the helper from 1.1 and pass it to `ProjectTabList`. Verified by TypeScript build passing and a unit test for the derivation if extracted.

## 4. Project tab and switcher badges

- [x] 4.1 Render a `project-tab-activity-badge` span in `ProjectTabList.tsx` between `project-tab-main` and `project-tab-close`, hidden at zero, with an `aria-label` stating count and state, and style it with the shared circle rule plus colour modifiers. Verified by an e2e test asserting the badge text and modifier class on a background project after a finished command.
- [x] 4.2 Thread `activityByProject` into `ProjectSwitcherMenu` and render the same badge in each row. Verified by an e2e or component test on a narrow window where the project has overflowed.
- [x] 4.3 Add a derived badge key to the `ProjectTabList` layout effect dependencies so overflow re-measures when a badge appears, disappears, or changes digits. Verified by an e2e test that fills the strip, triggers a badge, and asserts the trailing chrome stays visible.
- [x] 4.4 Confirm the badge is inert: clicking it activates the project and does not stop propagation. Verified by an e2e click on the badge switching projects.

## 5. Verification and docs

- [x] 5.1 Run `npm run lint`, unit tests, and `npm run test:e2e` (Docker-isolated). Verified by all suites green.
- [x] 5.2 Capture before/after screenshots of the header pills and a tab badge for the pull request. Verified by images attached to the PR description.
