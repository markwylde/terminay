## Context

Deleting a linked folder's worktree runs `deleteFolderAndItsPanels`
(`src/workspace/folderDeleteFlow.ts`) from `useFolderMenuController`. Today it:

1. shows `FolderPanelsQuestion` (Cancel / Close them / Move to General) when the
   folder holds panels;
2. closes each panel through `requestClosePanel` in `App.tsx`, which runs
   `observeTerminalClosePreflight` and `confirmTerminalClose` — a
   `window.confirm` per terminal with a non-shell foreground process;
3. calls `handleDeleteWorktree` (`useFileExplorerController.ts`), which opens
   its own `window.confirm` with the removal warning before `gitClient.remove`.

Each layer guards itself, so one Delete can cost 2 + N prompts. Plain folders
get steps 1 and 2.

Boundary: all of this is renderer UX. The server remains the authority — it
refuses `folder.delete` on a non-empty folder, closes a panel's session on
`panel.close`, and resolves, rechecks, and removes the worktree by opaque ID
with the reviewed HEAD. None of that moves or weakens.

## Goals / Non-Goals

**Goals:**
- One dialog per folder or worktree delete: choice of panel outcome, all
  warnings, Cancel and Delete.
- No prompt after Delete.
- Keep the invariant that nothing is deleted while a panel the user did not
  decide about is still in the folder.

**Non-Goals:**
- Closing a single terminal tab, a project, a window, or quitting — their
  close protection is unchanged.
- The Worktrees panel's "delete clean worktrees" bulk action and the shared
  Git route's removal confirmation.
- Any server, protocol, or Electron main-process change.

## Decisions

1. **The dialog asks everything before anything runs.** The controller first
   reads the panels the folder holds and, for its terminals, runs one
   `observeTerminalClosePreflight` per session (already bounded, and already
   what step 2 does) in parallel. The dialog opens with the result. When the
   observation is limited, the dialog says Terminay could not check whether the
   terminals are busy and that closing stops anything running, rather than
   guessing zero.
   *Alternative:* open the dialog immediately and fill the count in. Rejected:
   the Delete button would change meaning under the pointer.

2. **Radio group, not three buttons.** `FolderPanelsQuestion` becomes
   `FolderDeleteDialog`: a two-option radio group (Move to General, default;
   Close them), the warning text, the busy-terminal line shown only while Close
   them is selected, and Cancel / Delete. Initial focus is on Cancel, so Enter
   never deletes a worktree folder from disk; Escape and backdrop click cancel.
   *Alternative:* a dropdown. Rejected: two options read faster as radios and
   need one less click.

3. **Confirmed variants, not suppressed prompts.** `requestClosePanel` takes
   `{ confirmed: true }`, which skips `confirmTerminalClose` but still saves an
   autosaving file panel first. `handleDeleteWorktree` is split into
   `worktreeRemovalWarning(worktree)` (the text, shared with the dialog) and
   `removeConfirmedWorktree(worktree)` (queue, `gitClient.remove` with the
   reviewed HEAD, Deleting… state, refresh). The context-menu entry calls the
   folder flow; nothing else calls the unconfirmed remove. The flow's `ask`
   returns `{ outcome: 'move' | 'close' } | 'cancel'` and is called exactly once,
   including for a worktree with no panels.
   *Alternative:* a global "suppress confirms" flag. Rejected: ambient state
   that could leak into an unrelated close.

4. **Failure is an error, not a question.** If a move or close throws, or a
   panel not covered by the dialog is in the folder after the outcome is
   applied, the flow returns `panels-remain` / throws, nothing is deleted, and
   `onError` shows the reason (for example "A panel was added to Feature while
   it was being deleted; nothing was deleted."). The server's non-empty refusal
   stays the backstop.

## Risks / Trade-offs

- [A terminal becomes busy after the dialog counted it] → It is closed without
  a second prompt. The user chose Close them for the folder; the count is a
  courtesy, not a contract. Move to General, the default, never stops anything.
- [Removing the per-terminal prompt loses a guard] → Only on this path, and only
  after a dialog that names the count. Single-tab, project, window, and quit
  close protection are untouched.
- [Depends on `linked-folders`] → The `project-folders` delta modifies a
  requirement that change introduces; archive `linked-folders` first.

## Open Questions

None.
