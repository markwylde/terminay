## Context

`App.tsx` renders one `ProjectWorkspace` per folder of each project, keyed by `folderWorkspaceKey(projectId, folderId)`. A workspace is mounted the first time its folder is shown in the window and then stays mounted. Each workspace calls `useFileExplorerController`, which keeps its own state:

- `worktreePanelStatus`, the repository's worktree listing, including the properties extensions publish. The Folders tree, the folder menu and the Changes pane read it.
- `gitStatuses`, the per-path badges in the Files pane.
- `referencesRef`, the path-to-worktree-reference map that Git actions use.

All three start out empty (`EMPTY_WORKTREE_PANEL_STATUS`, `{}` and an empty `Map`). The hook's root effect then asks the server for a fresh listing (`trigger: 'root'`, which `isFreshGitPaneSync` treats as fresh). Until that request returns, the workspace in front draws its tree from the empty listing. `folderTreeWorktrees` returns `undefined` for that listing, so no card has a worktree to read, and every card loses its facts line and its branch label.

The desktop diagnostics log from the reported case shows the sequence. At 11:38:07.315 the worktree capture moves the terminal (`capture.decided: moved`). At 11:38:08.137 a `git.pane.sync` with `trigger: root` follows, from the new folder's workspace.

The server listing is complete and correct throughout. The git service carries unmeasured worktrees forward, and the forge extensions keep what they have published across context changes. The gap is entirely in the renderer.

## Goals / Non-Goals

**Goals:**
- A newly mounted folder workspace draws the tree, the Changes pane and the Files badges from what its window already knows about the same project and root.
- The listing a window remembers can never be drawn for another project or for an old root.

**Non-Goals:**
- Changing how often or how freshly the server measures. The new workspace's fresh root refresh still runs and replaces the seed.
- Sharing in-flight `Deleting…`/`Pulling…` marks between folder workspaces. Those are separate per-workspace sets with their own requirements, and this change leaves them alone.
- Collapsing the per-folder controllers into a single per-project controller. That would be a much larger restructuring of `ProjectWorkspace`, which owns the controller's Files pane state per folder as well.

## Decisions

### A per-window memory of the last listing, one entry per project

A small renderer module, `src/workspace/gitListingMemory.ts`, exports `createGitListingMemory()`. It returns `{ recall(projectId, projectRoot), remember(projectId, projectRoot, listing) }`. A listing is `{ statuses, worktrees, referencesByPath }`, the same projection `applyGitWorkspaceRefresh` publishes. `App` creates one memory per window with `useRef` and passes it to every `ProjectWorkspace`, which passes it to `useFileExplorerController` as `listingMemory`, together with the project's own root as `listingRoot`.

The key is the **project's own root** (`project.rootFolder` as `ProjectWorkspace` receives it), not the controller's `project.rootFolder`. `ProjectWorkspace` replaces the controller's root with the selected linked folder's worktree root (`explorerProject`), so keying by that root would give General, `beta` and `gamma` different keys and share nothing. The listing itself is repository-wide: the git client is project-scoped, and `list({ projectId })` returns every worktree whichever folder asks.

The memory keeps one entry per project id and stores the root alongside it. `recall` returns the entry only when its stored root equals the root asked for. `remember` overwrites the project's entry. A project whose root goes A → B → A therefore never recalls a listing taken under A after B has been remembered, and recalls nothing until a listing for the current root is remembered.

The hook:
- Initializes `worktreePanelStatus`, `gitStatuses` and `referencesRef` lazily from `recall(project.id, listingRoot)`. With nothing recalled it falls back to the existing empty values.
- Calls `remember(project.id, listingRoot, projection)` from `publish`, with the projection it has just applied, but only when `listingRoot` is still the root the request started under. A listing that lands after the project's root changed is not remembered for the new root. Every successful listing is remembered, including one that reports no repository or no worktrees, so an empty result replaces an old one.
- Seeds `shownGitProjectionRef` from the recalled listing, so a first listing identical to the seed is reported as `unchanged`.
- Changes nothing on failure. `preserveLastProjection` already keeps the current state, which is now the seed, and the failure is reported through `onOperationError` as before.

Workspaces already mounted when a root changes behave exactly as they do today. They keep their state until their own root refresh publishes. This change does not alter that.

Alternatives considered:
- **A module-level singleton map.** It would leak between windows sharing a renderer realm in tests, and it would outlive the `App` that owns the projects. A per-`App` instance has the same lifetime as the workspaces that read it.
- **Lifting the listing into `App` as React state.** Every folder workspace of the project would re-render on every listing, and the controller's refresh scheduling, which is keyed on the hook's own state, would have to move with it. The memory is read once per mount and written per publish, so it causes no re-renders.
- **Keeping the previous rows in `FoldersTree` while a listing is empty.** That is presentation-level guessing. It can't tell a project whose listing is still loading from a project whose last worktree was removed, and it doesn't fix the Changes pane or the Files badges, which flash in the same way.

### Boundary

The memory is renderer state that holds data this window's renderer already received for that project from the server's git service, through the project-scoped git client. It doesn't cross the renderer/privileged boundary or add a new authority, and keying by project id keeps the project boundary (ADR-0011, ADR-0049). Folder roots stay resolved by the server (ADR-0050). The memory never supplies a root or a path for a request. It only seeds what is drawn until the server answers.

## Risks / Trade-offs

- [A stale seed is drawn briefly] → It is the listing the other folders of the same window are showing at that moment, and the new workspace's fresh root refresh replaces it within one request.
- [Memory grows with projects opened in a window] → One entry per project and root, overwritten in place. The listing is the same size as what each workspace already holds.
- [A seed from a root the project no longer has] → `recall` matches the stored root, and each project keeps one entry, so a root that changed, or changed and came back, recalls nothing until a listing for the current root is published.
- [A seed outlives a failing server] → A failed first listing keeps the seed, as a failed refresh keeps any shown listing today, and the failure is reported. The next successful listing replaces it.

## Migration Plan

None. Renderer-only, with no persisted state.

## Open Questions

None.
