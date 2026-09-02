## Why

Sidebar presentation was not part of the canonical project state, so a restart,
renderer reload, reconnect, or second client did not restore the sidebar a user
had arranged for a project — and adjusting one project's sidebar could change
what another project presented.

## What Changes

- Add a bounded, validated sidebar model to the canonical workspace project
  schema and migrate existing workspace snapshots to project-local defaults.
- Add an authenticated, project-scoped workspace command and client facade for
  sidebar patches that publishes the normal workspace change event and keeps the
  project/window and terminal-session security boundaries.
- Hydrate renderer projects from the persisted model and commit visibility, pane
  collapse state, dimensions, order, and supported Agents and Documentation
  navigation state through that command.
- Retain the Settings sidebar values only as defaults for newly created
  projects; interacting with one project's sidebar no longer rewrites those
  defaults or another project's persisted state.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `server-owned-workspace-state`: the canonical project schema carries validated
  project-local sidebar state, patched through an authorized project-scoped
  command.
- `project-sidebar-layout`: sidebar presentation persists per project and
  restores across restart, reload, reconnect, and additional clients.

## Impact

The canonical workspace schema and its v4 migration, the workspace command and
delta surface, the shared client facade, and the renderer's Explorer, Agents,
Git, and Documentation sidebar panes. The packaged-app smoke contract had to
keep passing when a first renderer reload durably commits the migration.
