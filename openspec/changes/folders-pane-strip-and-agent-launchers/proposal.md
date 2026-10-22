## Why

The Folders tree is hard to read at a glance. Each folder is an inset, rounded card with generous padding, so a project with five folders reads as one long list of names, chips, and rows, and it is hard to tell where one folder ends and the next begins. The right sidebar already has a compact, recognisable way of heading a group, its pane title strip, and the two sides of the window look unrelated. Terminal rows are also set well in from the edge, which spends width the column does not have.

Starting an agent in a folder takes two steps: New terminal, then typing `claude` or `codex`. Most terminals in a worktree are agent terminals, and Terminay already knows which agents are installed, through the built-in agents extension, but offers no shortcut. Terminay has no way for an extension to offer one, so an agent other than the built-in ones could never get one either.

## What Changes

- Each folder in the Folders tree is a full-width block instead of an inset card. Blocks are separated by a narrow gutter and drawn without rounded corners or side margins.
- A folder's head is a header band in the style of the right sidebar's pane titles: a lighter band than the folder's rows, a small uppercase semibold title, a count of the folder's panels in a pill, and the menu button. The collapse chevron is the only control at its leading edge. The selected folder's header band is tinted.
- The branch line and facts line under a folder's title start at the leading edge of the header, under the chevron, with no further indent.
- Panel rows are set in so that each row's status indicator sits under the chevron, instead of under the title text.
- Every open folder still ends with a **New terminal** row. Hovering or focusing the row shows, at its end, one launcher button for the default shell and one for each available agent launcher, each with a tooltip. Choosing a launcher creates a terminal in that folder and starts that agent in it. Choosing the row's label still creates a terminal with the default shell.
- Extensions can contribute **terminal launchers** through a new `contributes.terminalLaunchers` array. A launcher has a namespaced id, a display name, an icon from Terminay's icon allowlist, and the harness it belongs to. At activation the extension registers a runtime that reports whether the launcher is available and which executable it starts.
- The built-in agents extension contributes launchers for Claude Code and Codex. A launcher is offered only while its harness switch is on and its CLI is found on the server account, by the same lookup chat providers use.
- `terminal.create` accepts an optional launcher id. The server resolves it, creates the terminal with the default profile, and types the launcher's executable into it, with no arguments. A client never supplies the command.
- Unchanged: carrying a folder by its title, with the lift-and-slide reorder, keyboard reordering, collapsing, terminal rows, renaming, dragging a terminal to another folder, the folder menu, the facts chips and their shortening, the details tooltip, and the tab peek.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-folders`: "The Folders tree" changes how a folder card is drawn (full-width blocks, a header band, a panel count, a tinted selected header, lines and rows starting under the chevron). "Creating a terminal from a folder card" gains launcher buttons on the New terminal row. Both requirements are added and modified by the unarchived `linked-folders`, `folders-sidebar-cards`, `worktree-folder-single-line`, and `left-column-tabs` changes; the deltas here are written against the latest of them and archive after them.
- `extension-platform`: a new `terminalLaunchers` contribution and its registration contract; "Contribution arrays" gains it. "Contribution arrays" is last modified by the unarchived `add-agent-chat-and-pixel` change, and this delta archives after it.
- `builtin-agents-extension`: the extension contributes Claude Code and Codex launchers, located the way its chat providers locate their CLIs and gated by its harness switches.
- `shell-profiles-and-terminal-launch`: terminal creation accepts a launcher id alongside a profile id, and a launched terminal starts its agent under the default profile.

## Impact

- **Folders tree** (`src/components/folders/FoldersTree.tsx`, `foldersTree.css`): block layout, header band, count pill, insets, and the New terminal row's launcher buttons. `FoldersColumn.tsx` and the project workspace pass the launcher list and a launch callback down.
- **Renderer launcher state** (`src/workspace/`): reads the server's launcher list for the selected server and refreshes it when it changes; `useTerminalCreationController.ts` passes a launcher id through to `terminal.create`.
- **Protocol** (`packages/protocol`): a `terminal.launchers` read operation and change event; an optional `launcherId` on `terminal.create`.
- **Server** (`packages/server-core/src/terminalService/protocol.ts`, `launchResolver.ts`, `extensions/`): launcher registry fed by the extension host, availability gated by harness switches, resolution at create time, and the typed start command.
- **Extension API** (`packages/extension-api`): manifest validation for `contributes.terminalLaunchers`, `context.terminals.registerLauncher`, and a minor API version bump.
- **Built-in agents extension** (`extensions/builtin-agents`): manifest entries and runtimes for the two launchers, reusing `chat/locate.ts`.
- **ADR**: a new owner-approved exception to ADR-0051, after ADR-0067, allowing a user's click to start an installed agent with no arguments.
- **Tests**: unit tests for the launcher contract, server resolution, and the tree model; Electron E2E for the tree's layout and the launcher row through `npm run test:e2e`.
