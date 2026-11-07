## Why

On a phone the compact switcher is a bottom sheet that is hard to use. It covers most of the terminal, wraps every project in a heavy card, gives search a full-width field the user rarely needs, and spells out every folder as a long upper-case `worktree-…` label. It also offers no way to reorder projects, folders or terminals and no way to close or remove a folder. Home is reachable only as a toolbar button inside the sheet, and the only create control is one plain "Terminal" bar. The installed agent launchers (Claude Code, Codex) that the desktop Folders tree offers are not available at all.

We prototyped five alternatives (artifact "Terminay Switcher POCs") and chose the **Rail Drawer**: a side drawer with a project rail and a folder tree, reworked with feedback on Home, workflow progress and launchers.

## What Changes

- **BREAKING (compact UI):** the compact switcher stops being a bottom sheet. It becomes a drawer that slides in from the leading edge, overlays the workspace and leaves a strip of the terminal visible at the trailing edge.
- The drawer has a **project rail**:
  - Home sits first, then a divider, then every project of every attached connection, each grouped under its connection, and finally a New project control.
  - Each rail project shows its colour and initials, plus a badge counting terminals that need the user, or else terminals that are working.
  - A server control at the top of the rail lists the servers, server updates and Add connection, all of which the sheet used to list.
- Beside the rail sits a **panel** for the selected rail item.
  - For a project, the panel shows a header (name, status summary, search, Edit), the Tabs and Agents tabs, and the project's **folder tree**. Folders collapse; linked folders show a branch glyph and their name without the `worktree-` prefix. Every folder header has New (+) and ⋯ controls.
  - For Home, the panel lists the six Home sections and the terminals that need the user.
- **Terminal rows:**
  - Each row shows its activity state and title. Its second line is the workflow step (when a workflow is attached) or the preview line.
  - The **workflow dial** sits in one fixed trailing column on terminal rows, aligned with the folder ⋯ controls. Folders never carry a dial.
  - Long-pressing a row opens a menu: Open, Rename, Move to folder, Close.
- The **folder ⋯ menu** offers new-terminal items for the default shell and each available launcher, followed by the folder's existing context-menu actions (Rename/Delete worktree, Rename/Delete folder, Pull, Commit & push with AI, Copy path, and so on).
- **Edit mode** reorders projects in the rail, folders in the tree and terminals within a folder through the existing ordering paths, and shows close controls for projects, folders and terminals behind the existing close protection and delete confirmations.
- The create bar becomes a **split new-terminal control**:
  - Its main part repeats the launcher this device used last.
  - Its disclosure opens a **dropup** listing the default shell and each available launcher in server order, with a target-folder picker.
  - A New project control sits beside it. Each folder's + control opens the same dropup aimed at that folder.
- The **compact chrome row** changes:
  - The breadcrumb becomes a title block: the terminal title over the project › folder path, with the active terminal's workflow dial. On Home it shows the Home section.
  - A **Home control** is added that switches between Home and the last project. Home is no longer a toolbar button inside the switcher.
- The filter keeps its collapsed-until-asked behaviour, but now sits in the panel header and lists results across every connection grouped as Terminals and Folders.
- Requirements written for the bottom sheet (project cards, upper-case folder label lines, the breadcrumb's disclosure chevron) are removed.

## Capabilities

### New Capabilities

None. Every change lands in an existing capability.

### Modified Capabilities

- `workspace-and-project-tabs`: compact bar presentation (title block, Home control), unified compact switcher (rail drawer), filtering, panel rows, closing, the Tabs and Agents tabs, the create bar (split control and launcher dropup), terminal creation, and project editing. New requirements cover the project rail, the folder tree, edit mode, the terminal row menu and the server menu. Project cards, folder labels and the breadcrumb disclosure requirements are removed.
- `terminal-activity-signals`: compact switcher activity presentation (summary in the panel header, a badge on the rail) and the preview line (yields to the workflow step).
- `connections-and-client-hosts`: the switcher overlays from the leading edge as a drawer.
- `project-folders`: folders on a compact workspace are presented as the drawer's folder tree with the folder context menu and launchers.
- `workspace-dashboard`: Home control presentation and Home sections on a compact workspace are reached from the drawer's Home rail item and the chrome row's Home control.
- `terminal-workflows`: the workflow dial on compact switcher rows and the compact title block.

## Impact

- **Client UI only:**
  - `src/workspace/CompactSwitcher.tsx` and its CSS are rewritten.
  - `src/workspace/compactSwitcherModel.ts` gains rail and tree shaping.
  - `src/workspace/CompactChromeRow.tsx` gains the title block and the Home control.
  - The `CompactSwitcher` wiring in `src/App.tsx` changes.
- The change reuses existing paths:
  - `project.move` and composition order for projects, the folder reorder command, and canonical panel order for terminals.
  - The panel folder move, the folder context-menu model (`folderMenuModel.ts`) and the folder delete flow.
  - The terminal close and project close protection, the terminal launcher list and launcher create, `TerminalWorkflowBadge` / `WorkflowDial`, and `useLongPress`.
- No server, protocol or persistence change. The only new device-local preference is the last-used launcher.
- E2E coverage for the compact switcher (`e2e/`) needs updating for the new structure.
