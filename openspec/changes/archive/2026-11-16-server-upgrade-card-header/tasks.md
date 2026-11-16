## 1. Card header

- [x] 1.1 In `src/workspace/ServerUpgradeProgress.tsx`, give the title `title={title}` and render the versions as `from`, a muted arrow span, and `to`, keeping the text `"<from> → <to>"`, and no version line when either is unknown. Verified by `scripts/server-upgrade-ui.test.mjs` asserting, for running, upgraded and not-upgraded titles with a long name, the title attribute and accessible name equal the full title, the version text, and no version line without a `from`.
- [x] 1.2 In `src/web/connectedRendererWorkspace.css`, stack the header (title one line with ellipsis, versions below with `overflow-wrap: anywhere`), retune width, padding, divider, step list, note and Close button with a `:focus-visible` ring. Verified by the e2e layout assertions in 3.1–3.3 and the screenshots.
- [x] 1.3 `serverUpgradeSources` names each source by its remembered profile's current label, falling back to the connection's. Verified by "an upgrade names the server as its profile is named now" in `src/workspace/serverUpgradeModel.test.ts` and by e2e 3.2, which renames the connection before upgrading.

## 2. Appearance and shared title

- [x] 2.1 Move the card's and backdrop's colours to custom properties with dark defaults and light values under `@media (prefers-color-scheme: light)`. Verified by e2e 3.4.
- [x] 2.2 `InPageWindow` sets `title` on its heading. Verified by e2e 3.2 asserting the confirmation heading's `title` attribute and one-line cut in the real frame (`InPageWindow` reads `document` while rendering, so it has no static-markup test).
- [x] 2.3 The confirmation's summary wraps anywhere (`src/App.css`), so a long name or build version stays inside the window. Verified by e2e 3.2 asserting the summary's text lies within the window.

## 3. End to end (`e2e/server-upgrade.spec.ts`)

- [x] 3.1 Short name: assert the running card's title is one line with a `title` attribute equal to its accessible name, the versions sit wholly beneath it; capture dark and light screenshots.
- [x] 3.2 Long name: rename the paired connection to a name wider than the card, open the confirmation and assert its heading is one line, cut, with the full `Upgrade <name>` tooltip (the Install latest title is the same frame's `title` prop, so this covers it); start the upgrade and assert the card title is cut on one line (scroll width greater than client width) with the full tooltip and accessible name while running and after success; capture dark and light screenshots.
- [x] 3.3 Long versions: with a phone-width window and an upgrade to a long unbroken version, assert the version line wraps (taller than one line) and every text box in the card lies within the card's box.
- [x] 3.4 Appearance: for emulated light and dark, assert the card surface differs between them and that the contrast ratio against the surface is ≥ 4.5:1 for the title, versions and step labels, and ≥ 3:1 for each step-state icon; the failed state, its detail and the Close button's focus ring are checked the same way in the rollback test.
- [x] 3.5 All of the above verified by `timeout 3000 npm run test:e2e -- e2e/server-upgrade.spec.ts` passing in Docker; screenshots reviewed against the criteria in design.md.

## 4. Checks

- [x] 4.1 `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, and `scripts/server-upgrade-ui.test.mjs` pass. Verified by their output.
- [x] 4.2 `openspec validate server-upgrade-card-header` passes, and `openspec validate --all` reports nothing new from this change. Verified by its output.
