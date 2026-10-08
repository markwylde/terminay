## Context

The Folders tree draws each folder of a project as a card (`src/components/folders/FoldersTree.tsx`). Every card but General has a grip. A pointer drag on the grip reorders a local preview of the folder ids, and on release the renderer sends `folder.reorder`; the keyboard does the same one place at a time. The tree shows the previewed order until the server's order arrives or three seconds pass.

General is excluded at three levels:

- The tree passes no grip handlers when `folder.kind === 'general'`.
- `folderOrderAfterMove` (`src/workspace/folderTreeModel.ts`) never moves the folder at index 0 and never places anything above it.
- The server refuses a `folder.reorder` whose first id is not the current first (`'the General folder stays first'`), and `validateProjectFolders` rejects any state whose first folder is not General. The renderer's snapshot check (`src/shared/serverWorkspaceReconciliation.ts`) rejects such a snapshot too.

Because General was always first, code reads `project.folderIds[0]` to mean "General". Found by search:

| Site | What index 0 stands for |
| --- | --- |
| `packages/server-core/src/workspace.ts` `folderForNewPanel` | the folder a panel lands in when none is named |
| `packages/server-core/src/workspace.ts` `panel.reorder` | fallback folder when the command names none and has no panels |
| `packages/server-core/src/folderReconciler.ts` `removeFolder` | where a removed folder's panels go |
| `packages/server-core/src/terminalService/launchResolver.ts` | the folder a terminal launches in when none is requested |
| `src/workspace/useFolderMenuController.tsx` | the "Move to General" target when deleting a folder |
| `src/workspace/folderTreeModel.ts` selected-folder default | the folder shown when nothing is remembered |
| `src/workspace/folderWorkspaces.ts` | same default, for merged folder inventories |
| `src/workspace/compactSwitcherModel.ts` `groupPanelsByFolder` | the group a panel with an unknown folder is listed under |

The current drag is drawn by reordering the cards in the document on each crossing. The dragged card never leaves its slot, so nothing follows the pointer and nothing slides. The project bar (`src/workspace/ProjectTabList.tsx`) uses `framer-motion`'s `Reorder.Group axis="x"` with `Reorder.Item`: the tab follows the pointer on one axis, is scaled up and shadowed `whileDrag`, and returns to its slot on release.

Constraints: the server owns workspace state and renderer code is untrusted (ADR-0011); a folder is a server-owned object that carries no authority (ADR-0049); nothing may be polled (ADR-0028). The workspace UI is bundled and served by the server, so the renderer and the server it talks to are the same build.

## Goals / Non-Goals

**Goals:**

- General has a grip and is reordered like any other folder, by pointer and keyboard, to any place.
- The server accepts any permutation of a project's folders, and General is still the one folder that a panel without a folder lands in.
- A dragged card follows the pointer vertically, the others slide to make room, and the card settles on release, matching the project bar's feel.
- Reduced motion is honoured.

**Non-Goals:**

- Reordering terminals within a folder, or dragging a folder card to another project.
- Making General renamable or deletable.
- Changing how a terminal row is dragged onto a folder. That stays an HTML drag and drop.
- Grips in a tab peek or in the compact switcher.
- Any new protocol command, field, or setting.

## Decisions

### 1. The server stops pinning General; General is found by kind

`folder.reorder` keeps its permutation check (same ids, each once, all of this project) and drops the first-id check. `validateProjectFolders` keeps "exactly one General" and drops "first". One helper on the server, `generalFolderId(state, project)`, returns the id of the project's folder whose kind is `general`, and every server site in the table above calls it in place of `folderIds[0]`.

This crosses the workspace-state boundary only by loosening a validation the server itself performs. The server remains the sole authority for folder order, the command stays scoped to one project, and a client can still not rename or delete General. Nothing a folder's position grants changes, because position grants nothing (ADR-0049).

*Alternative: keep General pinned and only add the animation.* Rejected: General is the row the request is about. In a project of one checkout and its worktrees it is the only card that cannot move.

*Alternative: let the renderer hold a per-device display order.* Rejected: folder order is server state shown identically on every device, and a second order held by the device would disagree with the compact switcher and the tab peek on other devices.

### 2. Every renderer site that means General asks for it by kind

The renderer gets the same helper over a snapshot. The delete flow's "Move to General" target and the compact switcher's fallback group use it. The snapshot check in `serverWorkspaceReconciliation.ts` requires exactly one General among a project's folders instead of General at index 0.

The default selected folder, used when a device remembers none for a project, becomes General by kind rather than the first folder in the order. A device that has never opened a project should land on the checkout the project was opened at, and should not land somewhere else because another device rearranged the cards.

`folderOrderAfterMove` becomes a plain move: it clamps the target to the list's bounds and moves the id, with no special index.

### 3. The drag is rebuilt on `Reorder.Group axis="y"`, started from the grip

The cards become `Reorder.Item`s inside a `Reorder.Group` with `axis="y"`, whose `values` are the previewed order or, when there is no preview, the server's. Each item sets `dragListener={false}` and owns a `useDragControls()`; the grip's `onPointerDown` calls `controls.start(event)`. This keeps the rule that only the grip starts a reorder, so a press elsewhere on the card still selects the folder and a terminal row still starts its own HTML drag.

`Reorder.Group`'s `onReorder` sets the local preview, as the hand-written pointer handler does today. `onDragEnd` calls the existing `commitOrder`. The pending-order timeout, the fall back to the server's order on refusal, the swallowed click after a drop, and keyboard moves through `commitOrder` are kept as they are. The hand-written `pointermove` midpoint logic and the `flushSync` it needed are removed, since the library measures the items.

The lift is `whileDrag` with a small scale and the existing `--dragging` shadow, and `dragMomentum={false}` as on the project bar. Items animate position only (`layout="position"`), so a card whose height changes, when a terminal is added or its checks list opens, is not stretched by a scale animation.

Layout animation cannot be limited to the time of a drag with `layoutDependency`: `Reorder.Group` rebuilds its list of item positions on every render from each item's layout measurement, so an item that is not measured on a render is not reorderable after it. Every render therefore measures, and a card whose height changes slides the cards beneath it over the same short transition.

The project bar sets `transition={{ layout: { duration: 0 } }}` on its items, so its neighbouring tabs do not slide. The Folders tree does not copy that line: the request is for cards that slide into place, so the items take a short layout transition, tuned by eye against the project bar during implementation. The value is a presentation detail and is not specified.

A peek renders plain `div`s as today, with no `Reorder` components, so a list that cannot be reordered carries none of the drag machinery.

*Alternative: keep the hand-written pointer drag and add a FLIP animation plus a transform on the dragged card.* Rejected: it reimplements what the project bar already takes from a library, and two reorder implementations would drift apart in feel, which is the thing being asked to match.

*Alternative: HTML drag and drop for cards.* Rejected for the reason the cards design gave: terminal rows already use it with the cards as drop targets, and the browser's drag image cannot be held to one axis.

### 4. Reduced motion is read from the media query

`useReducedMotion()` from `framer-motion` sets the items' layout transition to zero duration and drops the `whileDrag` scale. The card still follows the pointer, since that is direct manipulation and not an animation. No setting is added.

### 5. No migration, and rollback is what it already is

Every stored order satisfies the looser invariant, so nothing is rewritten on load. An older build would reject a project whose General had been moved, but an older build is never run against newer data: `docs/operations/release-update-policy.md` and `docs/operations/extensions.md` already say a server is rolled back by restoring the previous artifact together with the data-root backup taken before the update. That backup holds General first, so nothing is added to the procedure and no release note is needed. Writing General first on disk while presenting another order was considered and rejected: the stored order and the served order would disagree.

## Risks / Trade-offs

- [A site that reads index 0 as General is missed, and a panel lands in whichever folder is first] → The table above is the search result at the time of writing. A task repeats the search over `folderIds[0]` and `folders[0]` across `packages/`, `src/`, `electron/`, `apps/`, and `extensions/`, and a server test creates a panel with no folder after General has been moved last.
- [`Reorder` assumes items of similar size; cards vary from one line to many] → The library reorders on the dragged item's centre crossing a neighbour's, which holds for unequal heights. A task verifies a one-line card dragged past a tall one end to end.
- [The tree scrolls, and a drag near its edge does not scroll it] → The hand-written drag does not scroll it today either. Not made worse; auto-scroll is left out of scope and noted as a follow-up if it is missed.
- [Layout animation fires when a card's height changes for reasons other than a reorder, moving the cards below it] → Position-only layout animation makes this a short slide of the cards beneath, with no stretching. It cannot be switched off outside a drag without breaking the reorder (decision 3), so it is accepted.
- [A card's HTML drop handlers for a terminal drag stop firing once the card is a motion component] → `Reorder.Item` forwards DOM event handlers, as the project bar's tabs rely on for the same terminal drop. The existing end-to-end test that drags a terminal onto a folder covers it.
- [Focus is lost from the grip during a keyboard move because the item is moved in the document] → The existing refocus effect is kept and its end-to-end assertion stays.
- [An older build run against data in which General has moved] → Not a supported path; rollback restores the pre-update data root (decision 5).

## Migration Plan

Ship as one change: the server rule, the renderer's snapshot check, and the tree. The renderer is served by the server it talks to, so there is no window in which a renderer that requires General first meets a server that no longer guarantees it. Rollback is the documented one: the previous artifact with the pre-update data root.

This change's spec deltas modify requirements added by `linked-folders` and `folders-sidebar-cards`. Archive those two first, then this one.

## Open Questions

- None that block implementation. No in-force ADR is revisited: ADR-0049 says every project has one General folder that cannot be removed, and says nothing of its place in the order.
