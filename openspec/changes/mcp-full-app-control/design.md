## Context

Two callers hold workspace reach today:

- terminals in the automation terminal space, which Home shows. `controlReachForPlacement` in `apps/terminay-server/src/mcp/controlEndpoint.ts:152` derives this from placement;
- workspace-reach chats such as Pixel. `mintChat` (`controlEndpoint.ts:606`) gives them this reach, and Pixel opens with it (`packages/server-core/src/pixel/index.ts:88-102`).

ADR-0068 decision 3 fixes that **workspace scope widens reach, not powers**. The operation table in `apps/terminay-server/src/mcp/dispatcher.ts` therefore has no operation that is not also a project-scope operation, so Pixel cannot create a project. The table covers groups (:303-351), default scopes (:538-584) and handlers (:586-632). Reach is consulted only to pick and address terminals and projects, in `workspaceReach.ts`: `canAddressSession` at :33 and `resolveOpenTerminalProject` at :109.

The server already has every command needed for app-level control in `packages/server-core/src/workspace.ts`:

- `project.create` (:2388), `project.root.update`, `project.update`, `project.move`, `project.close` and `project.shellProfile.*`;
- `view.create`, `view.rename` and `view.close` (:2346-2386);
- `folder.reorder` and `folder.delete`;
- `panel.update`.

Settings, shell profiles, macros, automation runs and notifications have server operation registries (`settings.update`, `shell-profiles.*`, `macros.run`/`cancel`, `automations.runs.remove`/`prune`, `automations.missed.dismiss`, `notifications.dismiss`). The gap is authority and surface, not mechanism.

Three active changes rewrite the same requirements and must archive first: `add-agent-chat-and-pixel` (chat capability, capability reporting), `mcp-drives-the-agents-view` (view tools, permission groups, security boundaries) and `server-notification-manager` (Notifications group, notification tools). Every MODIFIED block here is written over their wording.

## Goals / Non-Goals

**Goals:**

- A workspace-reach caller can do to Terminay what a user can do, apart from a fixed excluded set, under the server's permission policy.
- A project-reach caller stays inside its project, and gains only renaming, re-iconing and recolouring of that project.
- No caller can widen its own or another caller's authority.

**Non-Goals:**

- Git and worktree actions, file create/rename/delete/edit, and root-folder browsing.
- Extensions, device pairing, server upgrade, recordings, Remote Access, stored credentials, and MCP permission settings.
- Device-local presentation settings (theme, fonts, keyboard shortcuts).
- Creating or editing macros.
- A different permission model for chats.

## Decisions

### 1. Reach is a second, fixed table beside the permission group

*Boundary: MCP capability scope, which is the project/window security boundary.*

`dispatcher.ts` gains `WORKSPACE_REACH_OPERATIONS`, the set of operations that need workspace reach. The dispatcher checks it before the permission gate, so a project-reach call to such an operation fails with `out_of_scope` and never prompts. `update_project` is the one operation with a field rule. With project reach it accepts only `name`, `icon` and `color`, and only for the caller's own project, which is resolved from the capability and never from a parameter. Like the group, the reach rule is fixed per operation and never inferred from parameters.

- *Alternative: give project reach `update_project` and let the handler refuse.* Rejected. The reach rule then lives in N handlers instead of one table that a unit test can enumerate.
- *Alternative: a separate permission group for project-scope project edits.* Rejected. A group may not depend on the caller (`MCP permission groups`).

### 2. Settings reach is an allow-list, not a deny-list

*Boundary: the vault and secret references (ADR-0003, ADR-0057), and the MCP policy itself.*

`update_settings` and `get_settings` reach only the server setting paths in `MCP_REACHABLE_SETTING_PATHS`, built from `SETTING_AUTHORITY` in `packages/server-core/src/settings/classification.ts`. The list leaves out `terminayMcp`, `remoteAccess`, `recording`, `shell` and `shellProfiles`, every secret reference, and every `connection-host` path. A setting added later is unreachable until someone adds it to the list. Writes go through the same normalisation and `settings.update` path that the Settings window uses, as a server-internal MCP principal. The audit names that principal.

- *Alternative: a deny-list of the excluded keys.* Rejected. A new credential-bearing setting would become agent-writable by default.

Recording settings are excluded with recordings, the owner's decision 4, because turning on `recordNewTerminals` or `captureInput` from an agent is recording control in all but name.

Device presentation settings stay out because the server never holds them. Reaching them would mean a new view-relay write into device storage. That is a separate decision, listed under Open Questions.

### 3. Three new permission groups

*Boundary: user permission policy (ADR-0068 decision 1).*

- **Projects & Windows** defaults to Always Allow (owner's decision). Its operations are reversible workspace edits. `close_project` is the one destructive exception, and it refuses busy projects without `force` (Decision 6).
- **Read Settings** defaults to Always Allow.
- **Change Settings** defaults to Ask Permission. A settings change applies to every client and every terminal on the server, so it has the widest blast radius of any group.

Reading and changing are split, as Read/Full already are for terminals and automations. Pixel can then answer "what's my scrollback?" without a prompt.

- *Alternative: one Settings group at Ask.* Rejected. Every read would prompt, and users would train themselves to click Allow This Session.

The approval detail for `update_settings` lists every path with its current and requested value, so the prompt is the full request, as the approval-binds-the-exact-request rule needs.

### 4. MCP drives the server commands directly, never the client wire

*Boundary: renderer is untrusted. Device authority (ADR-0048) is not MCP authority.*

The handlers call the workspace store, settings service, shell profile service, macro service, automation service and notification manager through a server-internal MCP principal, as automation tools already do (ADR-0068 decision 5). `automationSpaceRefusal` (`workspace.ts:3122`) applies unchanged, so the automation space cannot be closed, renamed or moved.

### 5. `create_project` validates like the start chooser and browses nothing

*Boundary: root-change authority (ADR-0066). Per-operation canonical roots (ADR-0020).*

- `~` alone maps to the start chooser's Home directory choice: no root, terminals start in the verified home directory.
- `~/…` and absolute paths are canonicalised per operation and must be existing directories. They then take the Open a folder path, which records a recent folder and names the project after the folder when no name is given.

The project is created already started, never awaiting a choice, and its first terminal launches through the normal resolver. ADR-0066 keeps root-folder browsing unreachable through MCP capability tokens. Nothing here lists directories, and a failed root returns only a typed reason.

### 6. `close_project` uses the fresh foreground observation

*Boundary: terminal-session lifecycle.*

Project close protection is a client-side prompt today. The MCP handler runs the same bounded fresh foreground-process sample, server-side, before committing `project.close`. Busy terminals fail with `busy` and a count unless `force: true` is passed. Under Ask, the approval detail shows the busy count. A sample that cannot complete is treated as busy. This is the safe direction for an unattended caller, and deliberately stricter than the window rule.

### 7. Workspace windows reuse the agent's client for presentation

*Boundary: device view state stays local (ADR-0070). Views are not window ids.*

`open_workspace_window` commits `view.create`, plus `project.move` for any named projects, on the server. It then sends a `present-view` `workspace-view.request` to the agent's client:

- Desktop presents it through the same host path that a tear-off uses;
- a browser switches its shown view.

When no agent's client exists, the window still exists and the result says `presented: false`, matching `split_terminal`'s `placed: false`.

`close_workspace_window` maps to `view.close`. That command already refuses a non-empty view or the last view, so an agent must move or close the window's projects first. A client presenting a deleted view closes that presentation, or switches to the first view if it has no other. This adds renderer handling for a vanishing view, which today only happens to the tear-off source.

Handles for windows are opaque, as project handles are (HMAC, `workspaceReach.ts`), so no view id crosses into agent context.

### 8. Notifications are addressed by reach, not by sender

*Boundary: terminal-session boundary for notifications.*

`list_notifications` returns opaque handles for the published notifications of terminals the caller can address. `dismiss_notification` resolves a handle back to the notification's exact owning project and session, and uses the same `notifications.dismiss` semantics as a user's dismissal, which acknowledge an activity notification. Neither needs a calling terminal, so chats may use them. `send_notification` still needs one.

### 9. MCP-launched macros have no launching client

*Boundary: macro execution is server-owned.*

The macro launching-client disconnect policy keys on a client connection. An MCP run has none, so it runs until it finishes, is cancelled, or its target terminal closes. A revoked capability does not cancel it, exactly as a terminal it wrote into keeps running. `cancel_macro` resolves the run's target terminal against the caller's reach.

### 10. Capability reporting filters by reach

`get_mcp_capabilities` marks workspace-reach tools unavailable to project reach, beside the existing calling-terminal filter for chats (`withoutCallingTerminalTools`). A tool's availability is then honest for the caller asking.

### 11. Archive ordering

This change archives after `add-agent-chat-and-pixel`, `mcp-drives-the-agents-view` and `server-notification-manager`:

- `MCP permission groups` and `MCP permission policy settings` merge the view tools of `mcp-drives-the-agents-view` with the Notifications group of `server-notification-manager`.
- `Capability reporting` extends `add-agent-chat-and-pixel`'s wording.
- `MCP security and privacy boundaries` and `Project-implicit tool surface` extend `mcp-drives-the-agents-view`'s wording.
- `Notification tools` replaces `server-notification-manager`'s.
- The `mcp-workspace-view` additions need that capability to exist.

Archiving this change first would fail. `openspec validate --all` reports the `Notification tools` delta as not yet archivable, which is expected.

## Risks / Trade-offs

- **[Risk] A user who sets Change Settings to Always Allow lets any workspace-reach agent rewrite server settings.** → The default is Ask, the excluded set holds every authority-bearing setting, and the allow-list keeps new settings out.
- **[Risk] Projects & Windows at Always Allow lets Pixel close a project.** → The busy check with an explicit `force`. A user who wants a prompt sets the group to Ask.
- **[Risk] Workspace reach is now much stronger, and creating a workspace chat needs only terminal-create authority (ADR-0068 consequences).** → No escalation is added. Terminal-create authority can already open an automation-space terminal and type `rm -rf`. The excluded set keeps credentials, remote exposure and the policy out of reach. This is recorded in ADR-0072.
- **[Trade-off] `close_workspace_window` needs an empty window.** → It mirrors the server rule, so a window cannot be deleted with projects in it. The agent moves or closes projects first.
- **[Trade-off] Device presentation settings stay unreachable.** → Listed under Open Questions.

## Migration Plan

New settings keys (`terminayMcp.permissions.projectsWindows`, `settingsRead`, `settingsChange`) fill from defaults on read. A stored policy object without them gets the defaults, as `notifications` did. Rollback removes the operations. Older servers report the new tools `unsupported_op`.

## Open Questions

- Should device presentation settings (theme, font, shortcuts) be changeable over MCP through the agent's client, as a view-relay write into that device's storage? This design leaves them out.

## Implementation Notes

Decisions made while implementing sections 1 and 2:

- **Operations are registered as their tools land.** `CONTROL_OPERATIONS` holds only operations that have a handler and a stdio tool, because the stdio adapter registers exactly that list. The section 1 table tests in `apps/terminay-server/test/mcp-app-control.test.mjs` carry the whole `mcp-permissions` group table and the whole workspace-only list from the `mcp-app-control` delta, and check every operation that exists against them. A later operation is checked the moment it is added to `CONTROL_OPERATIONS`; it must also be added to `WORKSPACE_REACH_OPERATIONS` in `dispatcher.ts` when the spec reserves it for workspace reach.
- **Two new public error codes.** `out_of_scope` (reach refusal, Decision 1) and `busy` (`close_project`, Decision 6) join `ControlErrorCode`, the endpoint's and the stdio adapter's code sets, and the dispatcher's public error mapping.
- **The view request is `presentView`.** The design calls it `present-view`; the relay's existing ops are camelCase (`showProject`, `selectFolder`), so it follows them.
- **MCP principal.** `packages/server-core/src/mcpPrincipal.ts` builds the server-internal command request (`system:mcp`, write scope, no project claim, speaks the start choice). The project and window tools run the workspace operation registry's own commands through it, so `project.close` closes terminals and releases the project exactly as a user's close does.
- **`create_project` takes the start chooser's path.** The folder is canonicalised first (`RootFolderBrowser.canonicalDirectory`, which never lists), then the project is created awaiting its start choice and started with `project.start` (home or folder). If starting fails, the created project is closed again, so nothing is left behind.
- **Root changes follow the project editor.** `update_project` with a root validates it as `create_project` does, then uses `project.root.update`, which rebinds the project's file services, and then `project.update`. A server without root rebinding takes the root with `project.update`.
- **A sample that cannot complete is busy.** On Desktop a `limited` foreground observation counts as busy for `close_project`, as does a sample that throws.
- **A deleted presented view.** A Desktop window presenting a deleted view closes; a presentation the host cannot close (a browser opened on `?view=`) shows the server's first view instead. The Desktop main window always presents the first view, so a Desktop client keeps a presentation.
- **Tests run on `node:test`.** The repository has no vitest; the tasks' "vitest" tests are `node --test` suites beside the code they cover.
