## Why

A user asked Pixel to "create a new project, just in my home directory", and Pixel answered that none of its tools can create a project. The same is true of an agent in a Home terminal. Both hold workspace reach, which today only widens which terminals they can address, so the agents a user talks to about the whole app can do less than the user can do with a mouse. The user wants the Terminay MCP to be able to do anything a user can do to Terminay, under the permissions set in Settings, with one exception: an agent in a project terminal stays confined to that project.

The technical cause is two rules in the current contract: workspace scope "grants the same tools as project scope", and the MCP non-goals forbid settings tools and any control beyond terminals, the agent's view and automations.

## What Changes

- **Reach becomes the authority line.** A workspace-reach caller (a terminal in the automation terminal space, which Home shows, or a chat with workspace reach such as Pixel) gets app-level control. A project-reach caller (a project terminal or a project-reach chat) keeps project-only control, and may additionally rename, re-icon and recolour its own project.
- **Projects and workspace windows.** New tools: `list_projects`, `create_project` (explicit root path, `~` for home), `update_project`, `move_project`, `close_project`, `list_workspace_windows`, `open_workspace_window`, `rename_workspace_window`, `close_workspace_window`. They are governed by a new **Projects & Windows** permission group, which defaults to Always Allow.
- **Settings.** New tools: `get_settings` and `update_settings` for server settings, plus shell profile management (`list_shell_profiles`, `save_shell_profile`, `delete_shell_profile`, `reorder_shell_profiles`, `set_default_shell_profile`). They are governed by two new groups. **Read Settings** defaults to Always Allow. **Change Settings** defaults to Ask Permission. These tools never reach the MCP permission policies, the Enable Terminay MCP switch, stored credentials, Remote Access, or recording settings.
- **Gaps in the existing groups are filled.**
  - Folders: `delete_folder` and `reorder_folders`.
  - Terminals: `update_terminal` for a tab's icon, colour, note and activity tracking; `open_terminal` takes an optional shell profile; `move_terminal_to_project` (workspace reach only).
  - Home: `focus_home`, and `focus_project` can show the automation space through Home.
  - Automation run housekeeping: `remove_automation_run`, `prune_automation_runs`, and `dismiss_missed_runs`.
  - Notifications: `list_notifications`, and `dismiss_notification` can remove any notification the caller reaches.
  - Macros: `list_macros`, `run_macro` and `cancel_macro`.
- `get_mcp_capabilities` reports only the tools the caller's reach can use.
- **Unchanged out-of-scope list.** Git and worktree actions, file create/rename/delete/edit, extensions, device pairing, server upgrade, recordings, remote access, stored credentials and MCP permission settings have no MCP tools. Root-folder browsing stays unreachable through MCP.

## Capabilities

### New Capabilities

- `mcp-app-control`: the app-level MCP tools (projects, workspace windows, settings, shell profiles, macros) and the rule that reach decides which of them a caller may use.

### Modified Capabilities

- `mcp-server`: workspace scope grants app-level control rather than the project tool set over more projects. The non-goals and security boundaries name the fixed excluded set instead of forbidding settings and cross-project control. The tool surface gains `update_terminal`, `move_terminal_to_project` and a shell profile for `open_terminal`. Automation tools gain run housekeeping. Notification tools gain listing and dismissal by reach. Capability reporting is filtered by reach.
- `mcp-permissions`: three new permission groups (Projects & Windows, Read Settings, Change Settings) with their defaults, and the new tools' group assignments.
- `mcp-workspace-view` (added by the active change `mcp-drives-the-agents-view`): folder deletion and reordering, Home tools, and showing the automation space through Home.

## Impact

- `apps/terminay-server/src/mcp/dispatcher.ts`: operation table, groups, default scopes, handlers, view-operation set, and reach filtering of the capability report.
- `apps/terminay-server/src/mcp/controlEndpoint.ts`, `terminalAdapter.ts`, `stdio.ts`: new handlers and tool descriptions.
- `packages/server-core`:
  - `workspaceReach.ts`: reach checks for project handles and window handles.
  - `workspace.ts`: the existing `project.*`, `view.*`, `folder.*` and `panel.update` commands, issued under an MCP principal.
  - `settings/`, `shellProfiles/`, `macroService/`, `automationService/`, `notifications/`, and `mcpApprovals/`, which gains the new groups and defaults.
- `src/`: Settings > AI > Terminay MCP lists the new groups, and the renderer applies the new view requests (present a window, show Home).
- Ordering: this change archives after `add-agent-chat-and-pixel`, `mcp-drives-the-agents-view` and `server-notification-manager`. Its deltas replace requirement text that those changes introduce or modify.
