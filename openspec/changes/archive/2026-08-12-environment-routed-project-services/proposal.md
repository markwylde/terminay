## Why

The PTY factory, launch resolver, file contexts, Git runner, process and journal
observation, and MCP environment were all composed globally against the server host, so a
project bound to a remote environment could still have privileged work executed on the
Terminay Server machine.

## What Changes

- Resolve PTY runtime, shell catalogue, home/cwd/path validation, and launch environment per
  canonical project environment.
- Route root preparation and browsing, canonical resolution, catalog/content/session, folder
  tasks, uploads, and watch observation through environment filesystems.
- Route Git, path, and CLI services only where the environment declares them, and present
  them as unavailable otherwise.
- Gate cwd and foreground observation, close protection, agent journals, and process
  observation by declared capability.
- **BREAKING** Remove generic bypasses to the server host: a missing provider or capability
  never falls back to This server.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `project-environments`: every privileged project service is routed through the canonical
  environment with explicit capability gating.
- `file-explorer-and-folder-tabs`: filesystem operations execute on the project's
  environment filesystem.
- `shell-profiles-and-terminal-launch`: shell discovery, launch resolution, and environment
  overlay are environment-scoped and redact server-local variables at remote boundaries.

## Impact

Server-core PTY and launch composition, filesystem and root services, Git runner, process
and journal observation, recording boundary, macro file fields, MCP environment exposure,
and the terminal, file, Git, activity, and recording test suites.
