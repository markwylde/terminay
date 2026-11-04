## Why

Deleting a worktree whose folder holds terminals asks up to three separate
questions: what to do with the panels, then "A process is still running in this
terminal. Close anyway?" once for every busy terminal, then the worktree's own
"Delete worktree?" confirmation. Each one restates a decision the user already
made by choosing Delete. One action should cost one answer.

The cause is that the three questions belong to three layers that each guard
themselves: `FolderPanelsQuestion` in the folder delete flow, close protection in
`requestClosePanel`, and the `window.confirm` inside `handleDeleteWorktree`.

## What Changes

- Deleting a worktree, or a plain folder that holds panels, shows exactly one
  dialog with **Cancel** and **Delete** buttons.
- When the folder holds panels, the dialog includes a choice of what happens to
  them: **Move to General** (selected by default, terminals keep running) or
  **Close them**. A worktree folder with no panels shows the dialog without the
  choice.
- The dialog carries everything the later prompts used to say: the worktree's
  name and path, the permanent-deletion warning (or, for a prunable worktree,
  that nothing on disk is deleted), and, when Close them is selected, how many
  terminals have a running process that closing will stop.
- After Delete, nothing else is asked. Panels are moved or closed without close
  protection prompts, and the worktree is removed without a second
  confirmation.
- If a panel cannot be moved or closed, or a new panel arrives in the folder
  while the delete runs, nothing is deleted and the reason is shown as an error,
  not as another question.
- Deleting a plain folder that holds no panels still asks nothing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-folders`: "Deleting a folder that still holds panels" becomes one
  dialog whose answer covers the panels, busy terminals, and the worktree.
  (This requirement is introduced by the active `linked-folders` change, which
  must archive first.)
- `git-worktrees-and-quick-push`: "Destructive removal confirmation and
  serialization" — the removal warning is shown in that one dialog when removal
  starts from a folder, and is not asked again.

## Impact

- `src/components/folders/FolderPanelsQuestion.tsx` — becomes the single delete
  dialog (radio choice, warning, running-process count, Cancel/Delete).
- `src/workspace/folderDeleteFlow.ts` and `useFolderMenuController.tsx` — the
  flow asks once up front, gathers the running-terminal count before asking,
  and calls confirmed variants of close and remove.
- `src/App.tsx` `requestClosePanel` / `closeFolderPanel` — an option to skip
  close protection when the user has already confirmed.
- `src/workspace/useFileExplorerController.ts` `handleDeleteWorktree` — split
  so the folder flow can remove a worktree without its `window.confirm`.
- `e2e/linked-folders.spec.ts` and unit tests for the flow.
- No protocol, server, or Electron main-process changes.
