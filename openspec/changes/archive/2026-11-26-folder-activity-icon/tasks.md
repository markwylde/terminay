## 1. Folders tree activity icon

- [x] 1.1 In `src/components/folders/FoldersTree.tsx`, derive one activity (`deleting` outranks `pulling`) and render it in the place of the folder/branch icon on the title line: `Trash2` or `ArrowDownToLine` inside a `role="status"` span with a `title` and visually hidden text of `Deleting worktree…` / `Pulling from origin…`. Verified by `npx tsc --noEmit -p .` and the unit tests in 2.1.
- [x] 1.2 Remove the `.folders-tree__deleting` and `.folders-tree__pulling` lines and stop suppressing the facts line while busy; keep `aria-busy` on the row and the 40% dimming of a deleting card. Verified by the unit tests in 2.1 and the e2e tests in 3.x.
- [x] 1.3 Treat the activity icon like a control in the title line's pointer-over handler, so moving onto it ends the details tooltip and its native `title` shows. Verified by the unit test in 2.2.
- [x] 1.4 In `src/components/folders/foldersTree.css`, size the activity icon to the 15px icon slot, colour it from the project colour, animate pull as a downward drop and delete as a pulse, and turn both animations off under `prefers-reduced-motion: reduce`; delete the old busy-line rules. Verified by the reduced-motion e2e check in 3.3 and `npx biome check` on the file.

## 2. Unit coverage

- [x] 2.1 Rewrite the deleting and pulling tests in `scripts/folders-tree-row.test.mjs` to assert: the activity icon and its label in the title line instead of the folder/branch icon; no busy line; the facts line still shown; `aria-busy` and dimming as specified; deleting outranking pulling (trash icon, dimmed); and the idle card restored. Verified by `npm run test:linked-folders`.
- [x] 2.2 Add a unit check that the activity icon is in the title line's own-tooltip selector, and cover the interaction end to end in 3.3 (moving onto the icon closes a shown details tooltip and cancels a pending one). Verified by the same run and the e2e run in 3.3.

## 3. End-to-end coverage

- [x] 3.1 Update the deleting test in `e2e/linked-folders.spec.ts` to record the trash icon (its label, the row's `aria-busy`, the card's 40% opacity) and that no `Deleting…` line appears. Verified by `npm run test:e2e -- e2e/linked-folders.spec.ts`.
- [x] 3.2 Update the pulling test to record the pull icon, its label, the row's `aria-busy`, full opacity, and that `alpha`'s header band height is the same while pulling as before. Verified by the same e2e run.
- [x] 3.3 Add a test that pulls General through a deliberately slow origin and asserts its header band height and the next folder's position do not change while the pull runs, that under emulated reduced motion the icon's computed `animation-name` is `none`, and that moving onto a linked folder's pull icon closes or cancels its details tooltip; capture screenshots of the pulling states, and of the deleting state with the removal held by a slow `core.fsmonitor` hook. Verified by the same e2e run passing and the screenshots being saved.

## 4. Checks

- [x] 4.1 Run `npx tsc --noEmit -p tsconfig.json` (no errors in changed files; remaining errors come from unbuilt workspace packages), `npx biome check` on the changed files, and `openspec validate folder-activity-icon`, and fix what they report for this change. Run `openspec validate --all` and note, without fixing, failures that belong to other changes. Verified by the first three exiting 0.
