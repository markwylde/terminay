## 1. Model

- [x] 1.1 Add a pure status-summary function to `src/workspace/compactSwitcherModel.ts` that groups a project's terminal rows into needs-you (`waiting`, `blocked`), `working`, `done`, and `idle`, ignores file and folder panels, and returns the counts in urgency order; expose the result on `CompactSwitcherProjectGroup`. Verified by new cases in `scripts/compact-switcher-model.test.mjs` covering mixed states, a project with no terminals, non-terminal panels, and two servers sharing a project id, run with `npm run test:linked-folders`.
- [x] 1.2 Add a formatter that turns the counts into the visible text (at most the two most urgent groups, `needs you` / `need you` pluralised, joined by ` · `) and the full accessible text (every non-empty group). Verified by unit cases for `2 working · 1 idle`, `1 needs you · 1 working` with three idle, and the empty case, in the same test file.
- [x] 1.3 Confirm filtering still yields a correct summary for a project narrowed by a filter (the summary describes the whole project, not the filtered rows). Verified by a model test that filters to one terminal and asserts the summary is unchanged.

## 2. Component

- [x] 2.1 Restructure `src/workspace/CompactSwitcher.tsx` so each project renders as one card element wrapping a header and a body, with the project colour supplied once as a custom property on the card. Verified by a `scripts/compact-switcher-ui.test.mjs` case asserting every folder label and panel row of a project is a descendant of that project's card and of no other, run with `node --test scripts/compact-switcher-ui.test.mjs` (the command every ui-test task below uses).
- [x] 2.2 Rebuild the header as swatch, name, status summary, close; remove `ProjectTabActivityDot` from this surface; keep long-press editing and the inert short press. Verified by ui-test assertions that the header contains the summary text and its accessible text, contains no activity dot, and still carries `data-compact-switcher-project`.
- [x] 2.3 Render a folder label line for every known folder, including a lone General folder, with the label as the activate-folder button and a sibling new-terminal button whose accessible name is `New terminal in <folder> of <project>`; render an empty folder as the label alone; remove the "No panels" row and paragraph. Verified by ui-test cases for a single-General project, a two-folder project, and an empty folder, asserting no `No panels` text is rendered.
- [x] 2.4 Keep the header new-terminal control only for a project with `folders.length === 0`. Verified by ui-test cases asserting it is present for an unknown-folders project and absent for a project with folders.
- [x] 2.5 Add an `onNewTerminalInFolder(project, folder)` prop and a prop carrying the front project title and selected folder name; replace the three-button footer with the create bar (wide `Terminal in <project> › <folder>` control plus New project and Add connection icon controls; New project wide when no project is in front). Verified by ui-test cases for both states asserting the label text, the accessible names of all controls, and that no new-terminal control exists without a project in front.
- [x] 2.6 Keep the create bar rendered when the filter matches nothing. Verified by a ui-test case rendering the empty state and asserting the bar's controls are present.

## 3. Styles

- [x] 3.1 Replace the `.compact-switcher__group`, `__project`, `__folder`, `__row`, `__terminal`, and `__actions` rules in `src/App.css` with the card, 30px tinted header, ruled folder line, compact two-line row, and create bar from Variant 2 of the mockup linked in proposal.md; remove the row left rail and any rule left unused. Verified by `npm run lint` passing and by a search showing no removed class name is still referenced in `src/`, `scripts/`, or `e2e/`.
- [x] 3.2 Draw the row and header close controls and the folder `+` at a dim 14px glyph while keeping each button at least 28px wide and as tall as its line, with the folder `+` hit area padded beyond the label line. Verified by an e2e assertion at a 320px viewport that each control's bounding box is at least 28px in both dimensions and that a tap at its centre triggers its action.
- [x] 3.3 Make the card border visible for every palette colour by mixing the project colour toward a light neutral floor. Verified by an e2e check that the computed border colour of a card using the darkest palette colour differs from the sheet background.
- [x] 3.4 Colour the summary's leading group with the token its rows' indicator uses for that state and leave `idle` neutral. Verified by an e2e assertion comparing the summary's computed colour with the row indicator's for a working terminal.

## 4. Host wiring

- [x] 4.1 In `src/App.tsx`, implement `onNewTerminalInFolder` by selecting the folder and then running the existing compact-switcher create path, and pass the front project title and selected folder name for the create bar label. Verified by tasks 5.2 to 5.4.
- [x] 4.2 Confirm the project `new-terminal` command creates in the device's selected folder when the folder was selected in the same turn, adding a wait on the folder workspace handle if it does not. Verified by e2e task 5.3 passing repeatedly (run it 5 times with `--repeat-each` through `npm run test:e2e`).

## 5. End-to-end

- [x] 5.1 Update the selectors in `e2e/compact-chrome-switcher.spec.ts` that address the old heading, row, and footer structure so the existing close, activate, filter, long-press, and dismissal tests address the new markup. Verified by the whole spec file passing under `npm run test:e2e`.
- [x] 5.2 Add an e2e test that the create bar reads `Terminal in <project> › <folder>` for the project in front, and that pressing it creates a terminal there, dismisses the sheet, and marks the new terminal current on reopen. Verified by `npm run test:e2e`.
- [x] 5.3 Add e2e tests that a folder label's `+` creates in that folder for (a) another folder of the project in front and (b) a folder of a background project, each asserting the created terminal's folder and that it is the terminal on screen. Verified by `npm run test:e2e`.
- [x] 5.4 Add an e2e test that with the dashboard selected the create bar has no new-terminal control and New project is the wide control. Verified by `npm run test:e2e`.
- [x] 5.5 Add an e2e test that a project header shows `2 working · 1 idle` style text matching its rows and updates when a `done` terminal is viewed. Verified by `npm run test:e2e`.
- [ ] 5.6 Capture the sheet at 390px and 320px wide with the fixture from the original screenshot (two projects, four folders, three terminals) and compare against Variant 2; confirm the sheet is shorter than before the change. Verified by attaching both screenshots and the before/after sheet heights to the pull request.

## 6. Specs and delivery

- [ ] 6.1 Before archiving, check whether `one-window-one-server` or `linked-folders` has archived and, if so, rewrite this change's deltas onto their requirement names as design decision 7 describes. Verified by `openspec validate --all` passing and a read-through of the folded main specs showing no duplicated or orphaned switcher requirement.
- [ ] 6.2 Run `openspec validate compact-switcher-project-cards --strict`, `npm run lint`, `npm run test:linked-folders`, and `node --test scripts/compact-switcher-ui.test.mjs`. Verified by all four exiting zero.
- [ ] 6.3 Open the pull request on `origin` (Gitea) with `tea`, and read back the commit statuses on the head SHA. Verified by every status being `success` or `skipped`.
