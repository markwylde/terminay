## 1. Shared context menu

- [x] 1.1 Add an opt-in `keyboard?: { autoFocus: boolean }` prop to `ContextMenu`. With it: `role="menu"`/`menuitem`/`separator`, focus of the first enabled item when `autoFocus`, Up/Down (wrapping) and Home/End between enabled items, skipping disabled ones. Without it, behaviour and markup are unchanged. Verify: e2e drives a keyboard-opened Files row menu with Down, Up (wrapping), Home and End; the file explorer context-menu e2e suite still passes.
- [x] 1.2 Add `:focus-visible` styles for `.context-menu__item` and `.context-menu__trailing` in `src/App.css`. Verify: e2e asserts the focused item has a non-`none` outline; screenshot of the keyboard-focused menu.

## 2. Files row menu

- [x] 2.1 In `BotFilesView.tsx`, remove the inline Download, Rename, and Delete icon buttons and add a "More actions for <name>" button (`aria-haspopup="menu"`, `aria-expanded`) that opens `ContextMenu` with the items for the entry's kind from design.md. Verify: e2e asserts a file row's menu lists Preview, Download, Rename, Delete; a folder's lists Open, Download, Rename, Delete; the `..` row has no button; and no row has the old Download/Rename/Delete buttons.
- [x] 2.2 Open the same menu on right-click of a row at the pointer, and on a keyboard `contextmenu` (context-menu key, Shift+F10) at the focused element with the first item focused, using the origin rules in design.md. Credential links open no menu either way. Verify: e2e right-clicks a folder row and sees the menu; presses Shift+F10 on a focused file row and sees the menu with Preview focused; right-clicks and presses Shift+F10 on the credential link row and sees no menu.
- [x] 2.3 Wire the items to the existing open, preview, download, rename, and delete flows, using the path captured when the menu opened. Delete puts the row in an in-row confirmation (focused danger Delete, Cancel; Escape cancels). Verify: e2e opens a folder and previews a file through the menu, renames a file through the menu, cancels a delete with Cancel and with Escape and sees the file remain, then deletes it after confirming.
- [x] 2.4 Return focus to the row's button after the menu unmounts when focus would otherwise be lost (design.md). Verify: e2e presses Escape in a keyboard-opened menu and asserts the button is focused; chooses Rename and asserts the rename input keeps focus.
- [x] 2.5 Clear the row menu and delete confirmation when the directory changes or the entry leaves the listing. Verify: e2e opens a row menu, has the fake helper remove the entry, and sees the menu close; opens a confirmation, navigates into a folder, and sees no confirmation on return.
- [x] 2.6 Style the row button and the confirmation in `bots.css`. Verify: dark and light screenshots of the open menu.

## 3. Test fixture

- [x] 3.1 Make the fake Files helper (`packages/server-core/test/fixtures/bot-files-helper.mjs`) keep a small stateful home: the existing `hello` file first, a folder, a credential link, and working `mkdir`, `rename`, and `delete`, with `watch` events on change. Verify: `node --test --test-force-exit --test-timeout=120000 packages/server-core/test/bot-files.test.mjs packages/server-core/test/bot-io-protocol.test.mjs` still passes.

## 4. End to end and checks

- [x] 4.1 Add a Files row menu test to `e2e/bots.spec.ts` covering 1.1, 1.2, and 2.1–2.5, and capture screenshots of the open menu in dark and light themes. Verify: `npm run test:e2e` for the bots suite passes in Docker.
- [x] 4.2 Run the typecheck, workspace model tests, Biome, `openspec validate bot-files-row-menu`, and `openspec validate --all`. Verify: all pass, except `--all` failures that already exist on `main` in other changes (such as `add-terminay-bots`), which are listed as unrelated.
