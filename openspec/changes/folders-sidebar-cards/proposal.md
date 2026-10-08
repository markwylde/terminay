## Why

The Folders tree is hard to read. A folder's branch, its change size, its pull request and its checks all share one line, and the column is narrow, so whichever fact comes last is clipped: the screenshot that started this shows `#360` cut to `#` and the checks count gone entirely. Every branch is drawn in orange whether or not the worktree has any work in it, so the colour says nothing. An empty folder says "No terminals yet" and offers no way to make one from where the user is looking. Folders cannot be reordered from the tree at all, although the server has always accepted a reorder. And when a terminal is moved into the folder of the worktree it created, a notice with Undo slides in at the foot of the column, which reads as an unexplained flash.

The column has little width and a great deal of height. This change spends height: each folder becomes a card with a line for its name, a line for its branch, and a line for its facts.

## What Changes

- Each folder in the Folders tree is drawn as a card. The first line is the folder's drag grip, icon, name and menu button. The second is its branch. The third is a row of chips for its change size, pull request and checks. Its terminals follow, inside the same card.
- The facts row never wraps. When the column is narrow the chips shorten their labels (`PR #360` becomes `#360`, `23 running` becomes the count beside its indicator) instead of moving to a second line.
- A branch is drawn in the accent colour only when its checkout is dirty, meaning it holds changes the default branch does not have. A clean checkout's branch is drawn in the ordinary text colour. The same rule applies to General, which now shows its change size chip when the project root checkout is dirty.
- A dirty linked folder with no pull request says `no PR`.
- Every folder card ends with a **New terminal** row that creates a terminal in that folder. It replaces the "No terminals yet" placeholder row.
- The selected folder's card carries no border or stripe. The active terminal's row is what is highlighted. When the selected folder has no active terminal row, its title row is tinted so the selection is still visible.
- Folders are reordered by dragging the grip at the left of a folder's title, or from the keyboard with the grip focused. General has no grip and stays first.
- The notice that says a terminal was moved into the folder for its new worktree is removed, and its Undo with it. The terminal is still moved and the device that was looking at it still follows it. A user who wants it back drags it to General.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-folders`: the Folders tree's presentation (cards, three lines, the New terminal row, how selection is shown), a linked folder's facts (dirty colouring, chips that shorten and never wrap, General's change size), reordering folders from the tree, and capture without a notice or Undo. This capability is introduced by the `linked-folders` change and is not yet in `openspec/specs/`; the deltas here are written against its requirement names and fold in after it archives.

## Impact

- `src/components/folders/FoldersTree.tsx`, `foldersTree.css`, `FoldersColumn.tsx`: the tree's markup and styles are rewritten as cards.
- `src/components/folders/FolderCaptureNotices.tsx` and the notice state in `src/App.tsx` and `src/workspace/folderCapture.ts`: removed. The capture event keeps driving which folder a device shows.
- `src/workspace/folderTreeModel.ts`: General carries its checkout's change, and each row says whether its checkout is dirty.
- `src/workspace/ProjectTabPeek.tsx`: the peek renders the same cards without the grip, the menu button or the New terminal row.
- `e2e/linked-folders.spec.ts`, `e2e/support/folders.ts`, `e2e/file-explorer-sidebar.spec.ts` and `scripts/folders-tree-row.test.mjs`, `scripts/folder-capture.test.mjs`, `scripts/folder-tree-model.test.mjs`: assertions on the placeholder row, the meta line, the selected class and the notice change.
- No protocol command, server behaviour, setting, or stored state changes. Reordering uses the existing `folder.reorder` command.
