## Context

The Folders tree (`src/components/folders/FoldersTree.tsx`, `foldersTree.css`) draws each folder as an inset card: `margin: 6px`, `border-radius: 5px`, a faint fill, a header of `8px 10px` padding whose branch and facts lines sit under the title, and panel rows inset `12px`. The right sidebar's pane titles (`src/components/sidebar/sidebar.css`) use a darker band, an 11px uppercase semibold title, a count pill, and 22px action buttons. The approved mock-up is board 1, "Pane strip", of the canvas `https://claude.ai/artifact/2cAggDVoABR4YQiXSUr4pq`.

Several folder changes are implemented but unarchived: `linked-folders`, `folders-sidebar-cards`, `worktree-folder-single-line`, `reorder-any-folder`, and `left-column-tabs`. The tree already carries a folder by its title with `framer-motion`'s `Reorder` (lift, slide, settle), has a collapse control and a New terminal row, and lists every panel. This change keeps all of that behaviour and changes only how it is drawn, plus the New terminal row's launchers.

Terminay has no way to start an agent in a terminal from the UI. The Git push agent types a command it builds in the renderer (`App.tsx` `buildGitPushAgentCommand`, `useTerminalCreationController.ts` `initialInput`). The built-in agents extension already locates `claude` and `codex` for its chat providers (`extensions/builtin-agents/src/chat/locate.ts`). ADR-0051 forbids Terminay starting or prompting an agent except where the owner has approved it in an ADR. ADR-0067 approved that for chat providers only.

## Goals / Non-Goals

**Goals:**
- Draw the tree as full-width blocks with a pane-title header band, a count pill, a tinted selected header, and lines and rows that start under the chevron, matching the mock-up.
- Show launcher buttons on the New terminal row on hover and focus: the default shell plus each available extension launcher.
- Let any extension contribute a launcher, with the built-in agents extension contributing Claude Code and Codex.
- Keep the command a launcher starts entirely under server authority.

**Non-Goals:**
- Changing reordering. The lift-and-slide carry, keyboard moves, and the server-owned order stay as they are.
- Launchers anywhere other than the tree's New terminal row: the compact switcher, the panel tab strip's new-tab button, and the command palette are left for later.
- Starting an agent with a prompt, model, flags, or environment, or resuming a session.
- Changing the right sidebar.

## Decisions

### 1. Restyle in place; no new tree component

The block layout, header band, insets, and count pill are CSS and small markup changes inside `FolderHeader`, `PanelRow`, and the New terminal row of `FoldersTree.tsx`. The `Reorder.Group` and `Reorder.Item` structure, the press-travel threshold, and the click swallowing stay unchanged, because they are what the specs for carrying a folder already test. *Alternative:* reuse `SidebarPane` from the right sidebar. Rejected: `SidebarPane` is a resizable stack pane with its own reorder and collapse model, and a folder's header has two more lines, chips, and a drop target for terminals that it does not support.

Concrete values come from the mock-up: column background as the gutter, `gap: 6px` between blocks; header band one step lighter than the rows; title `11px`, `600`, uppercase, `0.05em` letter spacing; count pill as `.sidebar-pane__count`; menu button 22px; header padding `6px 6px 7px 8px`; branch and facts lines with no left padding; panel rows with an `11px` leading inset so the 8px status indicator is centred under the 14px chevron. The selected header uses `color-mix` of `--project-color`, as the active row already does. The text-transform is CSS only, so accessible names and tooltips keep the label's case.

### 2. A launcher is a contribution resolved on the server, never a command from the client

`terminal.create` gains an optional `launcherId`. The server looks it up in a launcher registry fed by the extension host, gets the executable path from the launcher's last resolution, creates the terminal through the existing `launchResolver` path with no change to profile or working directory resolution, and then writes the quoted path and a carriage return through the terminal service's input path, tagged as a server input source. *Alternative:* keep the renderer's `initialInput` and send `claude` from the client. Rejected: it puts the command in the client, which the create protocol forbids for launch configuration, and it would let any client make the server type an arbitrary command. *Alternative:* make each launcher a shell profile whose executable is the agent. Rejected: profiles must not carry commands (`Profiles contain no secrets or executable script`), and an agent run as the terminal's process would close the terminal when the agent quits.

**Boundary crossed:** client to server. The client sends only an id, the server decides what runs, and the create stays bound to the same project and folder authority as any other create.

### 3. The extension resolves the executable, the host decides everything else

A launcher runtime has one method, `resolve(signal)`, returning an absolute path or an unavailable reason. The host validates the path (absolute, bounded, no control characters), quotes it for the resolved profile's shell family (POSIX single quotes, PowerShell single quotes, `cmd` double quotes), and never accepts arguments, environment, or a working directory from the extension. The host gates availability on the harness switch named in the declaration and does not call `resolve` while the switch is off. Resolution runs at activation, on a harness switch change, and on a client's list request when the last result is older than a short bound, with a deadline; failures make the launcher unavailable.

**Boundary crossed:** extension child to server. The extension is a trusted Node program (`Extensions are trusted Node programs`; ADR-0011), but its contribution is still bounded: it can name a file to run and nothing more, so a defective launcher cannot inject shell syntax.

### 4. A new `agent-launch` permission and `contributes.terminalLaunchers`

The permission and contribution follow the shape of `agent-chat` and `agentChatProviders`. The extension API version moves to the next minor with the new `context.terminals.registerLauncher`. Icons come from the existing Terminay-owned allowlist, which gains `agent-claude-code` and `agent-codex` marks drawn by Terminay. Third-party launchers use any allowlisted icon.

### 5. Renderer state for launchers

A small store in `src/workspace/` reads `terminal.launchers` for the selected server and subscribes to its change event, the way the agents and notifications stores do. `FoldersColumn` passes the list and an `onLaunch(folderId, launcherId)` callback into `FoldersTree`. The row reveals its buttons with `:hover`, `:focus-within`, and `@media (hover: none)`, so no JavaScript hover state is needed. The tooltip is the existing one used on the folder menu and chips.

### 6. Owner-approved exception to ADR-0051

Starting an installed agent in a terminal, at a user's click and with no arguments, is the launch ADR-0051 forbids and ADR-0067 says needs its own ADR. The repository owner asked for it in this change, so the adr step records it as a new ADR. The typed line is visible in the terminal and goes to the shell, not to the agent, and nothing is sent to the agent afterwards.

## Risks / Trade-offs

- [Typed start command races the shell's start-up, so the line can appear before the prompt or be read by a slow `.zshrc`] → Write it after the session reports its shell started, as the PTY holds type-ahead; an E2E checks that the agent's process starts under the shell.
- [An agent found by the login-shell lookup is not on the terminal's own PATH] → The absolute path is typed, so the terminal's PATH does not matter.
- [The tree's look drifts from the right sidebar if one is restyled later] → The count pill and title reuse the sidebar's tokens and class rules rather than copies of their values.
- [Uppercase titles make long branch names wider, so they truncate sooner] → Accepted in the mock-up review; the details tooltip and accessible name keep the full label.
- [Launcher resolution adds work at extension activation] → It reuses `locate.ts`, which caches the login-shell PATH per activation, and runs with a deadline.

## Migration Plan

No data migration. The launcher id is not persisted, so an older client simply never sends one, and against an older server the client's `terminal.launchers` read fails, which it treats as no launchers available, so it never sends a launcher id there. Rollback is reverting the change; no stored state refers to it.

## Open Questions

- None blocking. Whether launchers should also appear in the compact switcher and the tab strip's new-tab menu is left for a follow-up change.
