## 1. Trailing placement in the stylesheet

- [x] 1.1 Pin `.compact-breadcrumb__chevron` to the trailing edge of the pill with an auto leading margin, leaving the swatch, project, separator, and terminal segments and their truncation order untouched. Verified by `node --test scripts/tab-chrome-trailing-alignment.test.mjs`.
- [x] 1.2 Trim `.terminal-tab-content` to a 4px trailing inset against its 10px leading inset so the close button's own 5px around the glyph lands the `×` level with the title. Verified by the same suite asserting both the container inset and the close button's box.

## 2. Keep the alignment asserted

- [x] 2.1 Add `scripts/tab-chrome-trailing-alignment.test.mjs` asserting the chevron's auto margin, the tab's asymmetric padding, and the close button's 20px box around the 10px glyph rendered by `DockTabChrome`. Verified by that suite passing.
- [x] 2.2 Add the suite to `npm run smoke` so pull-request CI runs it. Verified by `npm run lint` and by the suite appearing in the smoke run.

## 3. Checks

- [x] 3.1 Run `openspec validate --all`, `npm run lint`, and `node --test scripts/tab-chrome-trailing-alignment.test.mjs`. Verified by all three reporting clean.
- [ ] 3.2 Open the pull request on Gitea with `tea`, then read back every commit status on the head SHA and confirm each is `success` or `skipped` before calling it green. Verified by the status listing itself.
