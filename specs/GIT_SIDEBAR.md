# Git Sidebar Specification

## Summary

Terminay's left sidebar currently holds a single panel: the file Explorer tree.
This feature splits that sidebar into **two stacked, resizable, collapsible
panes**:

- **Explorer** — the existing file tree, unchanged in behaviour.
- **Git** — a new panel that shows the working-tree status of the project's git
  repository: files added, modified, deleted, renamed, and untracked, each with
  a colour-coded status icon.

The two panes share the sidebar's horizontal width but divide its vertical
space. A draggable splitter between them lets the user resize, and each pane has
a header that collapses it down to just its title bar so the other pane can take
the full height.

## What We Are Trying To Do

When working in a repository, the file tree alone makes it hard to answer "what
have I changed?" — modified files are scattered across folders and only hinted at
by a colour on the tree row. We want a dedicated, always-visible **Git** panel
that lists exactly the files git considers changed, grouped by their state, so
the user can scan their working set at a glance and jump straight to any changed
file.

The design goals:

- Keep the Explorer behaviour identical to today; it simply becomes the top pane
  of a split sidebar.
- Add a Git pane below it that reads `git status` for the project root and renders
  a flat, grouped list of changed files with colour-coded icons (green = added/
  new, amber = modified, red = deleted, blue = renamed, grey = untracked, etc.).
- Make both panes independently **resizable** (drag the divider) and
  **collapsible** (click the pane header to fold it to its title bar).
- Reuse the existing git plumbing — Terminay already shells out to `git` and
  already polls status for the Explorer — rather than introducing a new git
  integration.
- Persist the split layout (divider position, collapsed state) per project,
  alongside the existing `fileExplorerWidth` / `isFileExplorerOpen` state.

This should feel like a natural extension of the current sidebar, not a new
window: same width, same resizer on the right edge, same toggle button.

## Current Codebase Shape

Terminay is an Electron + React 19 + Vite + TypeScript desktop app. The terminal
core uses `node-pty` and `@xterm/xterm`; the main workspace layout uses
**dockview** for the terminal/file/folder panels in the center. The left sidebar
is deliberately **not** a dockview panel — it is a hand-rolled `<aside>` with its
own pointer-driven resizer.

### The sidebar today

The sidebar is rendered in `src/App.tsx` (~line 5090) inside
`.project-workspace-body`:

```tsx
{project.isFileExplorerOpen ? (
  <aside
    className="file-explorer-sidebar"
    style={{ width: `${project.fileExplorerWidth}px` }}
  >
    <div className="file-explorer-sidebar__body">
      <FileExplorerTree ... />
    </div>
    <div
      className="file-explorer-sidebar__resizer"
      onPointerDown={(event) => { /* explorerResizeStateRef ... */ }}
    />
  </aside>
) : null}
```

- `FileExplorerTree` (defined in `src/App.tsx`, ~lines 774–1203) renders the
  recursive tree using nested `<details>` elements, drag & drop, context menus,
  rename/delete/new-file/new-folder, and inline custom SVG icons.
- The sidebar's **horizontal** resize is custom (pointer events, not dockview),
  tracked via `explorerResizeStateRef`. Width is clamped MIN=180 / MAX=520 /
  DEFAULT=280 and stored as `project.fileExplorerWidth`.
- Open/closed state is `project.isFileExplorerOpen`, toggled by the
  `.project-tab-sidebar-toggle` button (~line 6169) and a workspace command
  (~line 5700).

### Per-project sidebar state

Project tab state lives in `src/App.tsx` (the `ProjectTab` shape, ~line 125):

```ts
fileExplorerWidth: number;
isFileExplorerOpen: boolean;
```

Defaults at ~line 381. Updates flow through `onUpdateProject(project.id, { ... })`.
This is where new split-layout state (divider position / collapsed flags) should
be added so it persists with the rest of the project tab.

### Existing git plumbing (reuse this)

Terminay already runs git for the Explorer's per-row status colours:

- **Backend service:** `electron/fileViewer/gitDiffService.ts`.
  - `getExplorerStatuses(rawPath)` runs `git rev-parse --show-toplevel` then
    `git status --porcelain=v1 -z --untracked-files=all --ignored=no` and returns
    `FileExplorerGitStatuses`.
  - `parseExplorerStatuses()` (~line 184) parses the `-z` porcelain output,
    handling rename/copy (`R`/`C`) two-path entries, and collapses everything to
    just `'modified' | 'new'` today.
  - `toExplorerStatus()` (~line 214) maps porcelain codes: `??` → `new`; any of
    `M T D R C U` in index/worktree → `modified`.
- **IPC bridge:** `electron/preload.ts` (~line 52) exposes
  `getFileExplorerGitStatuses(dirPath)` → `ipcRenderer.invoke('fs:get-git-statuses', { dirPath })`.
- **Main handler:** `electron/main.ts` (~line 2108) `ipcMain.handle('fs:get-git-statuses', ...)`.
- **Types:** `src/types/terminay.ts` (~line 197):

  ```ts
  export type FileExplorerGitStatus = 'modified' | 'new'
  export type FileExplorerGitStatuses = {
    gitAvailable: boolean
    repoRoot: string | null
    statuses: Record<string, FileExplorerGitStatus>
  }
  ```

- **Renderer polling:** `src/App.tsx` polls every
  `FILE_EXPLORER_GIT_STATUS_POLL_INTERVAL_MS = 2500` ms while the sidebar is open
  and a root folder is set (`refreshGitStatuses`, ~lines 2028 / 3079–3142), with
  refresh on window focus and visibility change.

There are also richer git services for the file viewer (`getRepoInfo`,
`get-git-diff`) we can lean on later for "open diff" actions.

**Key gap:** the current status model is lossy — it only distinguishes
`new` vs `modified`, and it returns a flat `Record<path, status>` without staged
/ unstaged distinction or original-path-for-renames. The Git panel needs a
richer model (added / modified / deleted / renamed / untracked, ideally staged vs
unstaged). We should extend the backend to return a fuller status list rather
than reuse the lossy Explorer one verbatim.

### Styling & icons

- **Styling:** plain CSS, no CSS-in-JS. Sidebar styles live in `src/App.css`
  (`.file-explorer-sidebar`, `.file-explorer-sidebar__body`,
  `.file-explorer-sidebar__resizer`, `.file-explorer-tree-*`). Theme colours are
  CSS variables at the top of `App.css`. Git colours are currently hard-coded:
  `#73c991` (new/green), `#e2c08d` (modified/amber).
- **Icons:** `lucide-react` for chrome icons (imported in `App.tsx`); file-type
  icons in the tree are inline custom SVGs. The Git panel can use lucide icons
  (e.g. `GitBranch`, `FilePlus`, `FilePen`/`FileEdit`, `FileMinus`, `FileX`) or
  small status glyphs, colour-coded per status.

## Proposed Design

### Layout

Restructure `.file-explorer-sidebar` from a single body into a **vertical split**
of two panes plus the existing right-edge horizontal resizer:

```
┌─ file-explorer-sidebar (width: fileExplorerWidth) ─┐│
│ ┌─ pane: Explorer ──────────────────────────────┐ ││
│ │ [header: ▸/▾ Explorer]                         │ ││  ← collapsible header
│ │ FileExplorerTree (scrolls)                     │ ││
│ └───────────────────────────────────────────────┘ ││
│ ══════════ vertical splitter (drag) ══════════════ ││  ← resizes the two panes
│ ┌─ pane: Git ───────────────────────────────────┐ ││
│ │ [header: ▸/▾ Git · branch · N changes]         │ ││  ← collapsible header
│ │ Grouped changed-file list (scrolls)            │ ││
│ └───────────────────────────────────────────────┘ ││
└────────────────────────────────────────────────────┘│  ← right-edge horizontal resizer (existing)
```

- The outer `<aside>` keeps its current horizontal resizer and `fileExplorerWidth`.
- Inside, a new flex column holds: Explorer pane, a vertical splitter, Git pane.
- Each pane has a clickable header (chevron + title) that collapses the pane to
  just its header height. When a pane is collapsed, the other takes the remaining
  space and the splitter is inert/hidden.
- The vertical splitter drags the boundary; store the Explorer pane height (or a
  ratio) per project. Clamp to sensible min heights for each pane.

### New components (suggested)

- `src/components/sidebar/SidebarSplit.tsx` — owns the two panes, the vertical
  splitter pointer logic, and collapse handling. Mirror the existing
  `explorerResizeStateRef` pattern for the drag.
- `src/components/sidebar/SidebarPane.tsx` — generic collapsible pane (header
  with chevron + title + optional right-aligned actions/badge, scrollable body).
- `src/components/git-panel/GitPanel.tsx` — the Git pane body: grouped,
  colour-coded changed-file list.

(Exact file placement is flexible — `FolderPanel` lives under
`src/components/folder-viewer/`, so a `git-panel/` sibling folder fits the
existing convention. Keeping the new pieces out of the already-5500-line
`App.tsx` is preferred.)

### Git status data model

Extend the backend so the Git panel gets a richer, grouped status. Add a new
type (leaving the existing `FileExplorerGitStatuses` intact for the tree), e.g.
in `src/types/terminay.ts`:

```ts
export type GitFileState =
  | 'added'      // staged new file
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'

export type GitChangeEntry = {
  path: string            // absolute path
  relativePath: string    // relative to repoRoot
  state: GitFileState
  staged: boolean         // index vs worktree
  originalPath?: string   // for renames/copies
}

export type GitPanelStatus = {
  gitAvailable: boolean
  repoRoot: string | null
  branch: string | null   // current branch / detached HEAD short sha
  entries: GitChangeEntry[]
}
```

- Add a backend method (e.g. `GitDiffService.getPanelStatus(rawPath)`) that runs
  `git status --porcelain=v1 -z --branch --untracked-files=all --ignored=no` (the
  `--branch` header gives the current branch line) and maps each porcelain code to
  a `GitFileState` + `staged` flag, preserving rename original paths.
- Expose it via a new IPC channel (e.g. `fs:get-git-panel-status`) in
  `preload.ts` and `main.ts`, following the existing `fs:get-git-statuses`
  pattern.

### Git panel rendering

- Group entries into sections: **Staged Changes** and **Changes** (and
  **Merge Changes** / conflicts if present). If staged/unstaged distinction is
  deferred, group by state instead.
- Each row: colour-coded status icon + filename + dimmed relative directory +
  a single-letter status badge (`A`/`M`/`D`/`R`/`U`/`?`).
- Colour mapping (reuse/extend existing vars): added/untracked green `#73c991`,
  modified amber `#e2c08d`, deleted red, renamed blue, conflicted orange/red.
- Clicking a row opens the file (reuse `openFile`); ideally open it in the file
  viewer's diff mode where a diff is available (the file viewer already supports
  `file:get-git-diff`). Plain open is acceptable for a first pass.
- Empty state: "No changes" when the working tree is clean; a "Not a git
  repository" state when `gitAvailable` but no `repoRoot`; hide/disable the pane
  gracefully when git is unavailable.
- Reuse the existing 2.5s polling loop (and focus/visibility refresh) to keep the
  panel live; fetch both Explorer statuses and panel status together, or extend
  the existing refresh to populate both.

### Persistence

Add to `ProjectTab` in `src/App.tsx` (with defaults near line 381), persisted via
`onUpdateProject`:

```ts
sidebarExplorerHeight: number;   // or a 0..1 ratio of the split
isGitPaneCollapsed: boolean;
isExplorerPaneCollapsed: boolean;
```

Keep existing `fileExplorerWidth` / `isFileExplorerOpen` for the outer aside.

## Follow-up: list vs. tree view

The first implementation rendered the Git panel as a **flat list** (filename + dimmed
directory). Per follow-up feedback, the panel must support a **nested tree** view
(VS Code Source Control style — collapsible folders) in addition to the flat list,
and the choice must be a persisted **setting**:

- Add `gitPanelViewMode: 'list' | 'tree'` to `FileViewerSettings`
  (`src/types/settings.ts`), default `'tree'`, with default + sanitisation in
  `src/terminalSettings.ts` and a control in the File Viewer section of the
  Settings window.
- `GitPanel` takes a `viewMode` prop. In `'tree'` mode it nests entries by their
  path segments under collapsible folder rows (each group — Staged/Changes/Merge —
  becomes its own tree); in `'list'` mode it keeps the flat rows.
- A VS Code-style inline list/tree toggle sits in the Git pane header (via a new
  `actions` slot on `SidebarPane`) and writes the setting through
  `window.terminay.updateTerminalSettings`, so it persists and broadcasts.

### Tasks

- [x] Add `gitPanelViewMode` to `FileViewerSettings` with default `'tree'` + sanitisation
- [x] Add a Git-panel view-mode control to the Settings window (File Viewer section)
- [x] Add a `viewMode` prop to `GitPanel` and implement collapsible tree rendering per group
- [x] Add an `actions` slot to `SidebarPane` (interactive controls outside the collapse toggle button)
- [x] Add an inline list/tree toggle in the Git pane header that persists via `updateTerminalSettings`
- [x] e2e: tree nesting renders folder rows, folder collapse/expand, toggling to list shows the dir string, default is tree

## Follow-up: persisted sidebar defaults

Three related requests, all built on one pattern — a **global default setting** that
seeds new projects, which manual changes write back to, while **already-open
projects keep their own independent per-project state**:

1. Toggling tree/list in the Git pane header writes the persistent
   `sidebar.gitPanelViewMode` setting (view mode is global across projects).
2. A persisted **Default Explorer state** and **Default Git state**
   (`expanded`/`collapsed`) in Settings. New projects start with the pane(s)
   collapsed/expanded accordingly; manually collapsing/expanding a pane updates
   that default. Other open projects are unaffected.
3. Persisted **Default sidebar width** and **Default Explorer pane height**
   (the splitter position) in Settings. New projects use them; resizing either
   updates the default on drag-end. Other open projects are unaffected.

All five live in a new `sidebar` settings group (`SidebarSettings`) under the
Settings window's **Sidebar** section (Files category), rendered via the
declarative `makeField` system. `gitPanelViewMode` moved out of `fileViewer` into
this group. `createProjectTab` seeds each new project's `fileExplorerWidth`,
`isExplorerPaneCollapsed`, `isGitPaneCollapsed`, and `sidebarExplorerHeight` from
the defaults; pane toggles and resize-commits call `updateTerminalSettings` to
write the defaults back. `SidebarSplit` gained an `onTopHeightCommit` callback so
height persists on drag-end (not on every pointermove).

### Tasks

- [x] New `sidebar` settings group (`SidebarSettings`) + defaults + sanitisation; move `gitPanelViewMode` into it
- [x] Dedicated "Sidebar" Settings section (declarative `makeField` controls: view, default Explorer/Git state, default width, default pane height)
- [x] Panel tree/list toggle writes the persistent `sidebar.gitPanelViewMode` setting
- [x] `createProjectTab` seeds new projects' collapse state, width, and splitter height from the defaults
- [x] Pane collapse/expand writes `defaultExplorerState` / `defaultGitState`; open projects keep their own state
- [x] Sidebar-width drag-end writes `defaultWidth`; splitter drag-end (`onTopHeightCommit`) writes `defaultExplorerPaneHeight`
- [x] e2e: collapse seeds a new project's default while an already-open project keeps its own state

## Non-Goals (this iteration)

- Git **actions** (stage/unstage, commit, discard, push/pull) — view only for now.
- Branch switching / branch management UI.
- Inline diff rendering inside the Git pane (open in the existing file viewer
  instead).
- Multi-repo / submodule handling beyond the project's top-level repo.

These can be layered on later; the data model above leaves room (e.g. `staged`
flag) for stage/unstage to be added without reshaping the UI.

## Open Implementation Notes

- Reuse the existing pointer-capture resize pattern (`explorerResizeStateRef`)
  for the vertical splitter rather than introducing a new drag library; dockview
  is for the center workspace only and should not own the sidebar.
- Prefer extracting the new sidebar/git pieces into `src/components/` files to
  avoid growing `App.tsx` further.
- The current `FileExplorerGitStatuses` model is intentionally lossy; do not
  retrofit the panel onto it — add the richer `GitPanelStatus` alongside it so the
  tree's existing colour logic keeps working untouched.
- Coalesce git work: the panel and the tree both need `git status`; consider one
  backend call that returns both shapes, or share the porcelain parse, to avoid
  doubling the `git` invocations every 2.5s.
- Handle non-git project roots and missing `git` binary (`ENOENT`) the same way
  the Explorer already does.

## Tasks

### Backend: richer git status

- [x] Add `GitFileState`, `GitChangeEntry`, and `GitPanelStatus` types to `src/types/terminay.ts`
- [x] Add `GitDiffService.getPanelStatus(rawPath)` running `git status --porcelain=v1 -z --branch ...`
- [x] Parse porcelain codes into per-state + staged/unstaged entries, preserving rename original paths
- [x] Parse the `--branch` header line into the current branch / detached HEAD label
- [x] Handle non-git roots and missing `git` binary (ENOENT) gracefully
- [ ] Consider coalescing tree + panel status into a single git invocation to avoid doubling calls _(deferred: the two calls are issued together via `Promise.all`, so they overlap; a single shared invocation is a possible future optimisation)_

### IPC wiring

- [x] Add `fs:get-git-panel-status` handler in `electron/main.ts`
- [x] Expose `getGitPanelStatus(dirPath)` in `electron/preload.ts`
- [x] Add the method to the `window.terminay` typing surface (`TerminayApi` in `src/types/terminay.ts`)

### Sidebar split layout

- [x] Add `sidebarExplorerHeight`, `isExplorerPaneCollapsed`, `isGitPaneCollapsed` to `ProjectTab` with defaults
- [x] Create `SidebarPane` collapsible-pane component (header chevron + title + count/accessory + scroll body)
- [x] Create `SidebarSplit` component managing the two panes and the vertical splitter
- [x] Implement vertical splitter drag using the existing pointer-capture pattern, with min-height clamps
- [x] Implement per-pane collapse to header height; give the non-collapsed pane the remaining space
- [x] Persist split height + collapse flags via `onUpdateProject` (per-project, in-memory like `fileExplorerWidth`)
- [x] Move the existing `FileExplorerTree` into the Explorer pane unchanged

### Git panel UI

- [x] Create `GitPanel` component rendering the grouped changed-file list
- [x] Group entries (Staged Changes / Changes / Merge Changes) with section headers and counts
- [x] Render colour-coded status icons + filename + dimmed directory + status-letter badge
- [x] Wire row click to open the file (diff mode for tracked changes, plain open for untracked)
- [x] Add empty ("No changes"), non-repo ("Not a git repository"), and git-unavailable states
- [x] Show current branch and total change count in the Git pane header

### Data refresh

- [x] Extend the existing 2.5s poll (and focus/visibility refresh) to populate the Git panel status
- [x] Only poll the panel while the sidebar is open and a root folder is set
- [x] Keep the panel responsive to file changes already watched by the Explorer (shared `refreshGitStatuses`)

### Styling

- [x] Style the two panes, pane headers, chevrons, and the vertical splitter (`src/components/sidebar/sidebar.css`)
- [x] Colour-code git statuses (added/untracked green, modified amber, deleted red, renamed/copied blue, conflicted orange) in `src/components/git-panel/gitPanel.css`
- [x] Match the existing sidebar look (borders, hover states, scrollbars, typography)
- [x] Ensure the right-edge horizontal resizer and `fileExplorerWidth` still work with the new split

### Validation

- [x] Test in a git repo with added/modified/untracked/staged files _(e2e: grouped Staged/Changes, A/M/U badges, amber colour; deleted/renamed/copied/conflicted are implemented and parsed but not yet covered by an automated test)_
- [x] Test a clean repo (No changes state) _(e2e)_
- [x] Test a non-git project root _("Not a git repository", e2e; the missing-`git`-binary path is handled in the service but not separately tested)_
- [ ] Test resizing the vertical splitter and clamping at min heights _(manual only; drag clamps verified by reading code)_
- [x] Test collapsing the Git pane and restoring _(e2e: collapse hides the list; Explorer-pane collapse not separately tested)_
- [ ] Test persistence of split height + collapse state across reload and per project _(per-project in-memory state via `onUpdateProject`; the app does not persist project tabs to disk today, so cross-reload persistence is out of scope)_
- [x] Test that Explorer behaviour (tree, context menus, drag & drop, colours) is unchanged _(all 7 pre-existing file-explorer e2e tests pass)_
- [ ] Verify popout / remote workspace paths still render the sidebar correctly _(not yet verified)_
