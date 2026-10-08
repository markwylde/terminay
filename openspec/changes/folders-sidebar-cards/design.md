## Context

The Folders tree (`src/components/folders/FoldersTree.tsx`, styled by `foldersTree.css`) draws each folder as a row with the name on one line and, on a second, the branch followed by the change size, pull request number and checks count. The column is around 270px wide by default, so that second line overflows and the trailing facts are clipped. Terminals follow as indented rows, and an empty folder shows a "No terminals yet" row.

The tree renders a model built by `buildFolderTree` in `src/workspace/folderTreeModel.ts`. Each folder row already carries `branch`, `change` (`missing`, `delta`, `changed`, or `clean`), `pullRequest` and `checks`, but `change`, `pullRequest` and `checks` are only filled for linked folders. The same component, with `variant="peek"`, is the peek under a project tab.

The server already owns folder order: `folder.reorder` is a workspace command, the client library exposes it (`packages/client-core/src/workspace.ts`), and the server refuses an order that moves General. Nothing in the renderer calls it.

When the server moves a terminal into the folder of the worktree it created, it appends a `folder.terminal-captured` journal event. `useFolderCaptureEvents` reads it for two purposes: to keep a device that was looking at the terminal looking at it, and to raise a `FolderCaptureNotices` entry with Undo.

The layout was chosen from a mockup the owner reviewed and approved, published at https://claude.ai/artifact/6ASoadkzgLWPDbHG3Zm4GP. It is not kept in the repository: the linter reads every HTML file, and the mockup is a throwaway page. The pull request carries screenshots of the built column in its place. It is the reference for spacing, colour and type; where this document and the mockup differ on a visual detail, the mockup wins.

The requirements this change modifies belong to `project-folders`, which the `linked-folders` change introduces. `linked-folders` is implemented and merged but not archived, so `openspec/specs/project-folders/` does not exist yet.

## Goals / Non-Goals

**Goals:**

- No fact about a folder is clipped at the default column width.
- The branch colour means something: dirty or not.
- A terminal can be created in any folder from the tree, and folders can be reordered from the tree.
- The capture notice is gone without losing the focus-following it shared an event with.

**Non-Goals:**

- No change to what the server publishes about a worktree, to how dirtiness is measured, or to any workspace command.
- No change to the compact switcher, which lists folders in its own presentation on a compact workspace.
- No change to the folder context menu's contents, the checks list's contents, or the capture offer shown when the capture setting is off.
- No new setting. The card layout is the tree, not an option.

## Decisions

### 1. A folder is a card with up to three header lines

Each folder renders as one bordered card: title line, branch line, facts line, terminal rows, New terminal row. The card is the drop target for a terminal drag, replacing the highlight on the old folder row group. The checks list, when open, sits between the facts line and the terminals, as it sits beneath the folder row today.

Alternatives considered were the other nine layouts in the mockup rounds (a status gutter, an accordion, a detail tray, a hover card, a stat strip, and others). They were rejected in review; the cards were the only layout that kept every fact visible without interaction.

### 2. The facts line shortens by container query and never wraps

The facts line is a single non-wrapping flex row of chips that do not shrink. The tree body is a size container, and below 300px of inline size the pull request chip hides its `PR` prefix and the checks chip hides its word. 300px is the width at which the three full chips of the widest common case (`+1.1k −201`, `PR #360`, `23 running`) stop fitting beside the card's padding. Below the width at which even the short forms fit, the row clips at its trailing edge; that is under about 190px and beneath the column's useful range.

A container query is used rather than measuring in script because the breakpoint depends only on the column's own width, and the column is resized by dragging: a query costs nothing per frame, a `ResizeObserver` would re-render the tree on every pixel. This is the first inline-size container query in the tree's styles; `fileViewer.css` already uses a container.

The chip text is 9px in the monospace face, all three chips the same size, as approved on the mockup. Shortened chips keep their full text in `aria-label` and `title`.

### 3. Dirty is derived from the change the model already carries

`FolderTreeFolderRow` gains `isDirty`, true when `change.kind` is `delta` or `changed`. `clean`, `missing`, and an absent change are not dirty. A clean checkout draws no chip: the word `clean` that the row shows today goes, and the ordinary-coloured branch is what says clean. The card keeps `data-change` with the change kind so tests and styles can still tell a clean folder from one with no measurement. The branch line takes the accent colour from `isDirty` alone. This is the definition the Changes pane already uses for a worktree shown as not clean (`worktreeChange` in `folderTreeSources.ts`), so the tree and the pane cannot disagree.

`buildFolderTree` stops withholding `change` from General: it passes the change of the checkout that contains the project root, which it already resolves as `home` to find General's branch. `pullRequest` and `checks` stay limited to linked folders. General therefore shows an accent branch and a change size chip when the root checkout is dirty, and nothing else.

`no PR` is presentation: a linked folder that is dirty and has no `pullRequest`.

### 4. New terminal is the project's ordinary new terminal, placed by selecting the folder first

`FoldersTree` gains an optional `onNewTerminal(folderId)`. The column wires it to select the folder and then run the project's new-terminal path (`addTerminal({})`), which creates in the folder the device has selected. This is what the empty-folder placeholder's New terminal does and what the compact switcher's folder label does (`onNewTerminalInFolder`), so a terminal made from a card starts where any new terminal in that folder starts. It is deliberately not the menu's Open shell in folder, which forces the folder root (`addTerminal({ atFolderRoot: true })`); that stays a menu action. The peek passes no handler and so shows no row, as it shows no menu button.

This crosses no boundary: the renderer names a folder id, and the server resolves the folder's root and decides where the terminal starts (ADR-0050). A folder is not an authorization scope (ADR-0049), so choosing the folder grants nothing.

### 5. Reordering uses pointer events on the grip and the existing command

The grip is a button at the left of the title line. A pointer drag that starts on it moves the card among its siblings as a local preview; on release the renderer sends `folder.reorder` with the previewed order and keeps showing it until the server's order arrives, which is the previewed one once the command commits. If the server refuses, or has not answered after three seconds, the tree goes back to the order the server holds. The drag listens for the pointer on the window rather than capturing it on the grip, because reordering moves the card in the document and a moved element loses its capture. Arrow up and arrow down on the focused grip send the same command for a one-place move. General renders no grip, and the preview never places a card above it.

Pointer events are used rather than HTML drag and drop because terminal rows already use HTML drag and drop to move a terminal onto a folder, and the folder cards are that drag's drop targets. A second HTML drag source in the same list would have to be told apart from the first in every `dragover`. A pointer drag never enters that path.

The server remains the authority for order and for General staying first; the renderer's refusal to preview above General is a courtesy, not the rule. `folder.reorder` is an existing client command within one project, so no protocol surface is added and the project boundary (ADR-0011) is where it already was.

### 6. The capture notice is deleted; the capture event still moves the device's selection

`FolderCaptureNotices`, its styles, the notice list in `App.tsx`, and the notice helpers in `folderCapture.ts` (`captureNoticeText`, `withCaptureNotice`, `withoutCaptureNotice`, `CAPTURE_NOTICE_DISMISS_MS`, the `CaptureNotice` type) are removed, with the Undo handler. `useFolderCaptureEvents` keeps subscribing to `folder.terminal-captured` and keeps the part that selects the new folder on a device that was looking at the terminal.

Undo was a renderer action that issued an ordinary folder move back to the folder the terminal came from. Dragging the terminal's row onto General issues the same move. The server captures a terminal once, when the worktree is registered, so a terminal moved back is not moved again; a task verifies that end to end, because the spec keeps that guarantee and Undo was the only thing exercising it.

The server still appends the event and its payload still names the folder the terminal left. Nothing in the server changes.

### 7. Selection is shown by the active terminal row, with a title tint as the fallback

The card of the selected folder has no outline or stripe. `aria-selected` stays on the folder's title line. The active terminal row keeps its project-colour fill and loses the stripe down its left edge, as in the mockup. When the selected folder has no active terminal row (it holds no terminals, or its focused panel is not a terminal), the title line takes a tint of the project colour, weaker than the active row's.

The class `folders-tree__row--selected` stays on the selected folder's title line so that the end-to-end helpers that wait on it keep working; only what it draws changes.

### 8. The peek shares the card and omits the controls

`variant="peek"` renders the same card, branch line and facts line, and omits the grip, the menu button and the New terminal row. The peek's requirement in `workspace-and-project-tabs` (folders in order, each folder's branch line, each folder's terminals) is unchanged by this.

### 9. Deltas are written against `project-folders` before it is in the main specs

The deltas modify three requirements and add two, under the names `linked-folders` gives them. They are full replacements, so they fold in cleanly once `linked-folders` has archived and created `openspec/specs/project-folders/spec.md`. This change must archive after `linked-folders`. The `compact-switcher-project-cards` change set the same precedent for requirements it shares with unarchived changes.

## Risks / Trade-offs

- [The cards are taller, so fewer folders fit before the column scrolls] → The column body already scrolls. A project with many clean worktrees shows two-line cards (title and branch) plus the New terminal row; `delete-clean-worktrees` is the lever for the count itself.
- [A New terminal row on every card adds a row per folder that most of the time is not used] → It is drawn faint and replaces the placeholder row on empty folders, so an empty folder is no taller than before.
- [Removing Undo removes the one-tap way back after a capture] → Accepted by the owner. The move back is a drag, and turning the capture setting off replaces the move with an offer.
- [9px chip text is small] → Chosen on the mockup at the owner's request. Chips keep full-size accessible names and tooltips. The size is one custom property, so it is a one-line change after a few days of use.
- [`linked-folders` could change a requirement name before it archives] → Task 6.1 re-checks the names against the archived spec before this change archives.
- [End-to-end helpers depend on the tree's current markup] → The selected class and the `data-folder-terminal-session` attribute are kept. The placeholder text and `.folders-tree__meta` are not, and the specs that assert on them are updated in the same change.

## Open Questions

None. No in-force ADR needs revisiting.
