## 0. Ordering

- [ ] 0.1 Confirm `add-agent-chat-and-pixel`, `mcp-drives-the-agents-view` and `server-notification-manager` are archived before this change is archived, and rebase any MODIFIED block whose base wording changed in their archive. Verified by `openspec validate --all` reporting no "archive would refuse" notice for this change.

## 1. Reach and permission tables

- [x] 1.1 Add the Projects & Windows, Read Settings and Change Settings groups to `MCP_PERMISSION_GROUPS`, with labels and defaults (Always Allow, Always Allow, Ask). Fill missing keys from defaults on read. Verified by vitest: a fresh server has those defaults, and a stored policy without the keys gets them.
- [ ] 1.2 Add every new operation to `CONTROL_PERMISSION_GROUPS`, `DEFAULT_SCOPES` and `HANDLER_BY_OPERATION` in `dispatcher.ts`, with the groups the `mcp-permissions` delta lists. Verified by a vitest table test asserting each operation's group, and asserting that no operation lacks one.
  - Done for the section 2 operations. The table test already holds every group in the spec and checks each operation as it is added, so this completes with sections 3 and 4.
- [x] 1.3 Add `WORKSPACE_REACH_OPERATIONS` and the `update_project` field rule. Check them before the permission gate, failing with `out_of_scope`. Verified by vitest: every listed operation fails `out_of_scope` for a project-scope terminal and a project-reach chat under Ask, with no approval created; project reach may rename, re-icon and recolour only its own project.
- [ ] 1.4 Filter `get_mcp_capabilities` by reach. Verified by vitest: a project-scope capability sees `create_project`, `update_settings`, `open_workspace_window`, `focus_home` and `move_terminal_to_project` unavailable, and `update_project`, `list_projects` and `list_shell_profiles` available.
  - Reach filtering is in place and tested for the operations that exist; `update_settings`, `focus_home`, `move_terminal_to_project` and `list_shell_profiles` are checked by the same test once sections 3 and 4 add them.
- [x] 1.5 List the three new groups in Settings > AI > Terminay MCP. Verified by a component test showing ten groups with the right defaults.

## 2. Projects and workspace windows

- [x] 2.1 Implement `list_projects`, using opaque project handles and opaque window handles. Verified by vitest: a project-scope caller sees only its own project, and a workspace caller sees all projects plus the automation space.
- [x] 2.2 Implement `create_project` with `~`, `~/…` and absolute roots, validated through the start chooser's home and folder paths, launching the first terminal, and showing the project on the agent's client. Verified by vitest for each root form, a missing folder, a relative path, and no-client (`shown: false`), and by an assertion that no directory listing is reachable.
- [x] 2.3 Implement `update_project`, `move_project` and `close_project`. `close_project` runs a server-side fresh foreground sample and refuses with `busy` unless `force` is set. Verified by vitest: busy refusal and force, automation-space refusal, a root validation failure, and a move across windows that keeps sessions.
- [x] 2.4 Implement the workspace window tools over `view.create`, `view.rename` and `view.close`, with a `present-view` view request. Verified by vitest: creation with projects, `presented: false` with no client, and refusal of a non-empty window and of the last window.
- [x] 2.5 Renderer: apply `present-view` (Desktop opens a native window through the tear-off presentation path; a browser switches view), and handle a presented view being deleted. Verified by an E2E through `npm run test:e2e`: Pixel or an automation terminal opens a window holding a project, then closes it after moving the project back.

## 3. Settings and shell profiles

- [ ] 3.1 Build `MCP_REACHABLE_SETTING_PATHS` from `SETTING_AUTHORITY`, excluding `terminayMcp`, `remoteAccess`, `recording`, `shell`, `shellProfiles`, secret references and connection-host paths. Verified by vitest: a snapshot of the list, and an assertion that a newly added `SETTING_AUTHORITY` key is not in it.
- [ ] 3.2 Implement `get_settings` and `update_settings` through the Settings normalisation and `settings.update` path, as an MCP principal. A request is applied atomically and refused whole on any excluded, unknown or invalid path. Verified by vitest: the scrollback change, the refusal for an MCP policy path, the refusal for a mixed batch leaving scrollback unchanged, and no credential or secret reference anywhere in `get_settings` output.
- [ ] 3.3 Show each path's current and requested value in the approval detail for `update_settings`. Verified by vitest on the approval payload.
- [ ] 3.4 Implement the shell profile tools over `shell-profiles.*` with the editor's validation, with `list_shell_profiles` redacted. Verified by vitest: a save, a bounds failure, deleting a referenced profile, and redaction of environment values.

## 4. Gap-fill tools

- [ ] 4.1 `update_terminal` over `panel.update` (icon, colour, note, activity tracking), and an optional shell profile for `open_terminal`. Verified by vitest: metadata applied, an unknown profile refused with no terminal created.
- [ ] 4.2 `move_terminal_to_project` over the server-committed terminal move, returning the new handle. Verified by vitest: the old handle no longer resolves, the PTY is kept, and project reach and the automation space are refused.
- [ ] 4.3 `delete_folder` and `reorder_folders`. Verified by vitest: refusal of the General folder, a non-empty folder, a linked worktree folder, and a cross-project list.
- [ ] 4.4 `focus_home`, and `focus_project` for the automation-space handle, as view requests, with the renderer showing the named Home section. Verified by vitest for the reach refusal, and by an E2E through `npm run test:e2e` showing Home > Automations on the agent's client only.
- [ ] 4.5 `remove_automation_run`, `prune_automation_runs` and `dismiss_missed_runs` through the automation service's MCP principal. Verified by vitest: a run in progress survives a prune, and the audit names the MCP principal.
- [ ] 4.6 `list_notifications`, and reach-based `dismiss_notification`, both usable by chats. Verified by vitest: a project caller cannot resolve another project's handle, and dismissing an activity notification acknowledges its terminal.
- [ ] 4.7 `list_macros`, `run_macro` and `cancel_macro`, with field validation as in the launch modal and no launching client. Verified by vitest: an out-of-reach target fails not found, and a run survives the caller's capability being revoked.
- [ ] 4.8 Add tool descriptions for every new tool to `stdio.ts`, and update `PIXEL_INSTRUCTION` so Pixel knows it can manage projects, windows and settings. Verified by adapter tests listing each tool, and by a test asserting the instruction mentions `create_project`.

## 5. End-to-end and release

- [ ] 5.1 E2E through `npm run test:e2e`: a workspace-reach chat creates a project at `~` and a terminal opens in it; a project terminal's `create_project` fails `out_of_scope`; `update_settings` under the default policy shows an approval in the chat. Verified by the suite passing in Docker.
- [ ] 5.2 Update the mcp-server Purpose line at archive so it no longer says workspace callers cannot learn about other projects. Verified by `openspec validate --all --archived` passing after archive.
- [ ] 5.3 Run `npm run test:ci` and `openspec validate --all`. Verified by both passing.
- [ ] 5.4 Open the pull request on `origin` with `tea` and read back every commit status. Verified by each being `success` or `skipped`.
