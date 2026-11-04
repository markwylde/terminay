## Why

A worktree's card in the Folders tree shows two names: a folder title on top and the branch beneath. The title starts out as the worktree's directory name, which is usually the branch name with a prefix added or dropped, so the card reads as the same thing twice (`folders-sidebar-reorder-all-rows` over `worktree-folders-sidebar-reorder-all-rows`). It is not obvious which line is the title, which is the branch, or that the title can be renamed apart from either. A worktree already has a name people use for it, its branch, and that is the one pull requests and pushes refer to.

## What Changes

- A linked folder's card has one name line instead of two: the branch icon, the branch of its worktree, the unmerged mark, and the menu button. It has no separate folder title and no separate branch line. The drag grip, the accent colour of a dirty checkout, and the facts line beneath are kept.
- General and plain folders are unchanged: a folder icon and title, and for General the branch beneath.
- A worktree on a detached HEAD has no branch, so its line shows the worktree's directory name.
- When a linked folder's branch is also checked out by another checkout of the same repository, which Git allows only when forced, the line shows the worktree's directory name after the branch so the cards can be told apart.
- A linked folder is named by that same label wherever the workspace names a folder: the compact switcher, the menu that moves a terminal to a folder, the Files pane heading, and accessible names.
- **BREAKING** A linked folder's menu no longer offers Rename folder, and a linked folder is no longer renameable apart from its worktree. Rename worktree stays. A name a user gave a linked folder earlier is no longer shown.
- Resting the pointer on a linked folder's name line for one second, or leaving keyboard focus on its card for one second, shows a small tooltip of three labelled lines: branch, worktree name, and location. A location too long for the tooltip is cut from its start, so the end of the path stays readable.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-folders`: "The Folders tree" and "Linked folder presentation" give a linked folder one name line and define its label; "Every worktree has a folder" drops the rule that a linked folder is renameable; "Folder context menu" drops Rename folder for a linked folder; a new requirement adds the details tooltip.

## Impact

- `src/workspace/folderTreeModel.ts` — a linked folder's row carries its label and the facts the tooltip shows; a new pure function derives the label from the branch, the detached state, and the other checkouts' branches.
- `src/workspace/folderTreeSources.ts` — the tree's worktree projection carries `isDetached` and `head`, which the listing already reports.
- `src/components/folders/FoldersTree.tsx`, `foldersTree.css` — the one-line head for a linked folder, and a new tooltip component with its delay.
- `src/workspace/folderMenuModel.ts`, `src/workspace/useFolderMenuController.tsx` — Rename folder is offered for a plain folder only.
- `src/workspace/compactSwitcherModel.ts`, `src/components/TerminalTab.tsx`, `src/App.tsx` — every other place that names a folder reads the label.
- No server, protocol, or persistence change. The server keeps a name for a linked folder and keeps it following the worktree's directory; nothing shows it.
- `project-folders` is not yet a main spec: `linked-folders`, `folders-sidebar-cards`, and `folders-dirty-means-unpushed` introduce and amend it and are not archived. This change's delta is written against the requirements as those three leave them and must archive after all of them.
