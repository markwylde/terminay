## 1. Confirmed close and removal paths

- [x] 1.1 Add `{ confirmed?: boolean }` to `requestClosePanel` and `closeFolderPanel` in `src/App.tsx`; when set, skip `observeTerminalClosePreflight`/`confirmTerminalClose` but keep the autosave step. Verified by the typecheck and by task 4.2 showing no confirm call.
- [x] 1.2 Move the removal warning out of `handleDeleteWorktree` in `src/workspace/useFileExplorerController.ts` into `worktreeRemovalWarning(worktree)` in `src/workspace/folderDeleteFlow.ts` (the permanent and prunable texts), and drop its `window.confirm` so it is the confirmed removal (queue, reviewed-HEAD remove, Deleting… state, refresh); the folder menu is its only caller. Verified by the typecheck and a grep showing no `window.confirm` left in the worktree removal path.

## 2. One question in the flow

- [x] 2.1 Change `deleteFolderAndItsPanels` so `ask` is called once, before any step, for every linked-folder delete and for a plain folder that holds panels, and returns `'move' | 'close' | 'cancel'`; close calls the confirmed close; a failed step or an uncovered panel returns `panels-remain` with nothing removed. Verified by unit tests for the flow: asked once with and without panels, cancel removes nothing, an arriving panel blocks removal, a plain empty folder is not asked.
- [x] 2.2 In `useFolderMenuController.tsx`, before asking, gather the folder's terminal sessions and run their close preflights in parallel; pass the running count (or "limited") and the worktree warning to the dialog; report `panels-remain` through `onError` with a sentence naming the folder. Verified by the typecheck and task 4.3.

## 3. The dialog

- [x] 3.1 Replace `FolderPanelsQuestion` with `FolderDeleteDialog`: title, worktree name and path, removal warning, a Move to General / Close them radio group (Move selected) shown only when panels are held, the running-process line shown only while Close them is selected, and Cancel / Delete with initial focus on Cancel; Escape and backdrop click cancel. Verified by a component test covering each of those states.

## 4. End-to-end

- [x] 4.1 Update `e2e/linked-folders.spec.ts` delete tests to the radio + Delete dialog and drop the queued native confirms. Verified by `npm run test:e2e -- e2e/linked-folders.spec.ts`.
- [x] 4.2 Add an e2e test: a worktree folder with a busy terminal, Close them, Delete — the terminal closes, the worktree is gone, and the dialog recorder shows zero `confirm` calls. Verified by `npm run test:e2e -- e2e/linked-folders.spec.ts`.
- [x] 4.3 Extend the e2e test "a worktree being deleted says Deleting… on its card" (a worktree folder with no panels): one dialog without the radio group, and Delete removes it with zero `confirm` calls. Also update the two worktree deletes in `e2e/file-explorer-sidebar.spec.ts`. Verified by the same command.
- [x] 4.4 Run `openspec validate one-dialog-deletes-a-folder --strict`, `npm run typecheck`, and the unit suites. Verified by their clean output.
