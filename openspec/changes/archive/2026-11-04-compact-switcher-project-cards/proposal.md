## Why

On a phone the compact switcher is the only way to see and move between projects, folders, and terminals, and its tree is hard to read. Folder names are smaller and dimmer than the terminals they hold, so they read as captions rather than parents; server, project, folder, and terminal all start within 10px of the same left edge; an empty folder spends a whole row saying "No panels"; and a project heading shows two dots side by side, one for colour and one for activity. Creating is no clearer: the project's `+` does not say which folder it creates in, and three equal-weight footer buttons take a full row for actions that are not equally common.

The sheet was built as a list with headings. It now carries four levels, and a list with headings does not show containment.

## What Changes

- Each project in the compact switcher is drawn as a thin bordered card. Its header is tinted in the project's colour and carries the colour swatch, the project name, a text status summary, and the project's close control.
- The header's status summary (for example `1 needs you`, `2 working · 1 idle`) replaces the activity dot on compact switcher project headings. The activity dot stays on project tabs and on the wide project switcher menu.
- Every folder a project is known to have is drawn as one ruled label line inside the card, including a project whose only folder is General. An empty folder is just its label line; the "No panels" row is gone.
- Each folder label carries its own new-terminal control, which creates in that folder. The project header's new-terminal control remains only for a project whose folders this window does not know.
- Terminal rows keep their title, last output line, activity indicator, and close control, drawn more compactly.
- The three-button footer is replaced by a create bar: one wide primary control that names where it will create, `Terminal in <project> › <folder>`, with New project and Add connection as icon controls beside it. With no project in front the wide control is New project.
- Close controls stay on every panel row and every project header, drawn smaller and dimmer. Closing behaviour and close protection are unchanged.

Not changing: which panels are listed, activation, long-press editing, filtering, the connection heading, the server list, overlay and dismissal behaviour, and everything above 640px.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-and-project-tabs`: the unified compact switcher's project groups become cards with a status summary; folders are always-present label lines that each offer a new terminal; the create actions move into a context-aware create bar; a terminal created from a folder's control lands in that folder; the compact switcher no longer shows the project activity dot.
- `terminal-activity-signals`: a compact switcher project heading presents a status summary counted from its terminal rows instead of the project's activity count badge.

## Impact

- `src/workspace/CompactSwitcher.tsx` and its styles in `src/App.css`: restructured markup and new presentation.
- `src/workspace/compactSwitcherModel.ts`: a per-project status summary derived from the rows it already builds.
- `src/App.tsx`: wiring for creating a terminal in a named folder and for the create bar's label.
- Tests: `scripts/compact-switcher-model.test.mjs`, `scripts/compact-switcher-ui.test.mjs`, `e2e/compact-chrome-switcher.spec.ts`.
- No protocol, server, Electron, or persistence change. The work is renderer presentation over commands that already exist.
- Overlaps two active changes. `one-window-one-server` replaces the **Unified compact switcher** requirement this change modifies, and `linked-folders` specifies folders on a compact workspace in `project-folders`. Whichever archives second has to be reconciled against the first; design.md says how.
- The approved mockup is Variant 2 at https://claude.ai/artifact/2kqVfAi6XNDHvFVkc7QzNU.
