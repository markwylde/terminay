## Context

`FolderHeader` in `src/components/folders/FoldersTree.tsx` draws every card the same way: a title line (grip, folder icon, `folder.name`, menu button), then a branch line when the folder has a checkout, then a facts line. For a linked folder `folder.name` is server state: `folderReconciler.ts` names the folder after the worktree's directory when it first sees the worktree, and renames it when the worktree moves only while the name still equals the old directory name. A user can change it with Rename folder (`folder.rename`).

The same `folder.name` is read by the compact switcher, the menu that moves a terminal to a folder (`TerminalTab.tsx`), the Files pane heading, and the accessible names of the card's controls.

The tree has no tooltip component. Every hover text is a native `title` attribute, which cannot be laid out as three lines with a path cut from its start.

`folders-sidebar-reorder-all-rows` is in flight in another worktree and changes which cards show the drag grip. It touches the same title line.

## Goals / Non-Goals

**Goals:**

- A linked folder has one name on its card, and it is the branch.
- The same label names that folder everywhere the workspace names a folder.
- The worktree's directory and path stay one hover away.
- No server, protocol, or persistence change.

**Non-Goals:**

- Changing General or a plain folder.
- Removing the name the server stores for a linked folder, or making the server refuse `folder.rename` for one. The reconciler itself issues that command to follow a moved worktree.
- A tooltip for General, for a plain folder, or in the compact switcher.
- A general-purpose tooltip system. One component serves this card.
- Showing the tooltip on touch, where there is no hover.

## Decisions

**The label is derived in the renderer from the worktree listing, not stored.** A pure function in `src/workspace/folderTreeModel.ts` takes a linked folder's worktree and the branches of the repository's other checkouts and returns the label: the branch; or the directory name when the worktree is detached or missing from the listing; or the branch with the directory name as a suffix when another checkout holds the same branch. The branch is already a read-only fact in the bounded listing the tree consumes, so no authority moves and nothing new crosses the server boundary (ADR 0011, ADR 0050). Alternative considered: have the server rename the folder to its branch on every checkout. Rejected because it turns a presentation rule into a stream of workspace mutations on every `git switch`, and it would collide with the unique-folder-name rule in the forced duplicate case.

**Detached is read from `isDetached`, not from the branch text.** `GitWorktreeStatus.branch` holds a short detached-HEAD label when there is no branch. The tree's projection in `folderTreeSources.ts` gains `isDetached` and `head` so the label rule and the tooltip do not parse that text.

**The suffix is shown only while it is needed.** Another checkout counts when it is any other worktree of the same repository, the project root checkout included, that is on the same branch and not detached. General keeps its own title, so only the linked folders in the collision carry a suffix. The suffix is drawn in the muted colour after the branch and before the unmerged mark, and truncates with the branch; the unmerged mark still never truncates.

**One label function, every surface.** `folderLabel` is exported and called by the tree model, `compactSwitcherModel.ts`, the move-to-folder menu, the Files pane heading, and the accessible names (`Actions for …`, `Reorder …`, `New terminal in …`, `Checks for …`). In those plain-text places the suffixed form is written `branch (directory)`. Alternative considered: change only the card. Rejected because the compact switcher would then call the same folder by a name the card never shows.

**Rename folder is removed from the menu model for a linked folder; the server command is left alone.** `folderMenuModel.ts` offers `rename-folder` for `kind === 'plain'` only. The stored name of a linked folder keeps following its worktree's directory exactly as today. A name a user set earlier stays in server state and is simply not presented; nothing migrates. Alternative considered: have the server refuse the command for a linked folder and reset renamed ones. Rejected as server and persistence work that changes nothing a user can see.

**The tooltip is a small component of its own, opened by a one-second timer.** `FolderDetailsTooltip` is rendered through a portal into the document body, so the column's `overflow` cannot clip it, and is positioned beside the name line and clamped inside the window. The timer starts when the pointer enters a linked folder's name line or when the card takes keyboard focus (`:focus-visible`), and is cancelled, closing the tooltip if open, on pointer leave, blur, pointer down, Escape, scroll of the tree, a drag starting, or the folder's menu opening. It has `role="tooltip"`, is referenced by `aria-describedby` on the card head, and takes no pointer events, so it can never sit between the pointer and a control. The native `title` on a linked folder's label is dropped so two tooltips do not stack. The timer is one `setTimeout` per hover, cleared on unmount; it is a UI delay, not a poll (ADR 0028).

**The three lines are labelled, and each is a single unwrapped line.** `Branch`, `Worktree`, `Location`. Branch is the branch name, or `detached at` and the short head when detached. Worktree is the directory name. Location is the worktree's path exactly as the listing reports it. The tooltip has a maximum width; branch and worktree truncate at their end.

**The location is cut from its start in CSS.** The value's box is `direction: rtl` with `text-overflow: ellipsis`, and the text inside is isolated left-to-right (`unicode-bidi: plaintext` on an inner element) so the leading `/` and the separators keep their order and the ellipsis lands at the start. This is a known trick with a known failure, punctuation migrating to the wrong end, so the end-to-end test asserts on the rendered box rather than trusting the stylesheet. Alternative considered: measure and trim in script. Kept as the fallback if the CSS form does not hold in Electron's Chromium and the browser client alike.

## Risks / Trade-offs

- A user who named a linked folder loses that name on the card → accepted and marked breaking in the proposal; the stored name is left in place, so the decision is reversible without data loss.
- The label of a card changes when its worktree switches branch, so a card can appear to rename itself → this is the point of the change; the card's position and its terminals do not move.
- Two worktrees on a detached HEAD in directories of the same name (in different parents) would show the same label → the tooltip's location tells them apart; not handled further.
- The delta rewrites four requirements that three unarchived changes also write → the tasks pin the archive order and a re-read of the folded spec.
- `folders-sidebar-reorder-all-rows` edits the same title line → whichever lands second rebases; the grip stays the first thing on the line in both.
- The `direction: rtl` truncation can misplace punctuation → asserted end to end, with script trimming as the fallback.
