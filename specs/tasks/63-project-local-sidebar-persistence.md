# Project-local sidebar persistence

## Goal

Persist each project's sidebar presentation in canonical server-owned workspace
state so a restart, renderer reload, reconnect, or second client restores that
project's own sidebar without changing another project.

## Governing specifications

- [Server-owned workspace state](../features/server-owned-workspace-state.md)
- [Workspace and project tabs](../features/workspace-and-project-tabs.md)
- [File explorer and folder tabs](../features/file-explorer-and-folder-tabs.md)
- [Agent status and Agents sidebar](../features/agent-status-and-sidebar.md)
- [Git worktrees and Quick Push](../features/git-worktrees-and-quick-push.md)
- [Documentation sidebar and editor](../features/documentation-sidebar-and-editor.md)

## Scope

- [x] Add a bounded, validated sidebar model to the canonical workspace project
  schema and migrate existing workspace snapshots to project-local defaults.
- [x] Add an authenticated, project-scoped workspace command/client facade for
  sidebar patches. It must publish the normal workspace change event and retain
  the project/window and terminal-session security boundaries.
- [x] Hydrate renderer projects from the persisted model and commit visibility,
  pane collapse state, dimensions, order, and supported Agents/Documentation
  navigation state through that command.
- [x] Retain Settings sidebar values only as defaults for newly created
  projects. Interacting with one project's sidebar must not rewrite those
  defaults or another project's persisted sidebar state.
- [x] Cover reducer migration/persistence, protocol authorization, renderer
  normalization, and restart/hydration independence between two projects.
- [ ] Preserve the packaged-app smoke contract when a first renderer reload
  durably commits the one-time v4 workspace migration.

## Acceptance checks

- [x] A project sidebar returns exactly as it was after Terminay restarts or a
  renderer reconnects.
- [x] Changing Explorer, Agents, Git, or Documentation in one project leaves a
  second project's visibility, order, dimensions, collapse state, and supported
  navigation state unchanged.
- [x] Legacy workspace snapshots acquire valid project-local sidebar state
  without altering project identity, environment binding, panels, or layout.
- [x] Invalid sidebar patches and cross-project commands are rejected without
  changing the workspace revision.
- [x] Focused tests pass, followed by `npm run test:e2e` in Docker.
- [ ] The packaged macOS smoke and the full PR workflow pass.

## Definition of done

The canonical workspace snapshot/delta exposes validated project-local sidebar
state, all supported sidebar interactions persist through it, the feature specs
match the product contract, and the focused plus Docker Electron end-to-end
verification pass.
