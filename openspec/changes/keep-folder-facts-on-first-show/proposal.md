## Why

When a folder is shown for the first time in a window, every card in the Folders tree briefly loses its git facts. For a few seconds the change size, the pull request chip, `no PR`, the unmerged mark and the checks chip all disappear, and a linked folder's label falls back from its branch to its directory name. Then they all come back. The most common trigger is a terminal that runs `git worktree add`, which an agent does when it starts a workflow: the terminal is moved into the new folder, that folder comes to the front, and the whole tree flickers. Selecting a folder the window has not shown yet does the same. Resizing the column and reordering folders do not.

The cause is technical. Each folder has its own workspace view, and each view keeps its own copy of the repository's worktree listing. A view is mounted the first time its folder is shown, and its copy starts out empty. The tree in front is drawn from that empty copy until the view's first listing request returns. Nothing in the listing is wrong and nothing has been cleared. The new view just doesn't know what the views already on screen know.

## What Changes

- A folder view shown for the first time starts from the last worktree listing the window holds for the same project and the project's own root. Its Folders tree, its Changes pane and the Git badges in its Files pane draw from that listing straight away, and the view's own refresh replaces it when it returns.
- A card's facts line and linked-folder label stay on screen without a gap when another folder is created and brought to the front, or when a folder is selected for the first time.
- A window holds one listing per project, for the root it was taken under, in its renderer only. A failed first listing keeps what was shown, and a successful listing, even an empty one, replaces it.
- New end-to-end coverage: `a worktree card keeps its facts on screen while another folder is created or first selected` in `e2e/linked-folders.spec.ts`. It fails on `main` with the card showing `alpha-tree 0`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-folders`: adds requirements that a folder shown for the first time keeps the tree's git facts, and that a held listing stays within its project and root.

## Impact

- `src/workspace/useFileExplorerController.ts`: seeds its worktree listing, Git statuses and worktree references from a per-project memory, and records each listing it publishes.
- A new renderer module that holds the last listing per project and root.
- `src/App.tsx`: one memory per window, passed to every folder workspace.
- No server, protocol, IPC or extension change. The forge extensions and the git service are unchanged.
