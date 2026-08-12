# Environment-routed project services

## Goal

Route every privileged project service through the canonical environment while
preserving existing terminal/client contracts and failing unsupported remote
capabilities explicitly.

## Delivery phase

Phase 2, in parallel with [Tasks 44](./44-extension-installation-and-management.md),
[45](./45-project-environment-and-extension-ui.md), and
[47](./47-official-puzed-extension-foundation.md) after the Phase 1 contracts.

## Dependencies

- [Task 41](./41-project-environment-domain-and-local-provider.md)
- [Task 42](./42-extension-api-manifest-and-host.md)

## Governing specifications

- [Project environments](../features/project-environments.md)
- [Terminal workspace](../features/terminal-workspace.md)
- [File explorer and folder tabs](../features/file-explorer-and-folder-tabs.md)
- [Shell profiles and terminal launch](../features/shell-profiles-and-terminal-launch.md)

## Current gap

PTY factory, launch resolver, file contexts, Git runner, process/journal
observation, and MCP environment are composed globally against the server host.

## Parallel work streams

### Terminal and launch

- [ ] Make PTY/runtime, shell catalogue, home/cwd/path validation, and launch
  environment resolve per canonical project environment.
- [ ] Preserve session/stream/attachment/presentation contracts and filter
  server-local MCP/control/provider variables at remote boundaries.
- [ ] Gate cwd/foreground observation and close protection by capabilities.

### Files, roots, and drafts

- [ ] Route root prepare/browser, canonical resolver, catalog/content/session,
  folder tasks, uploads, and observation through environment filesystems.
- [ ] Normalize provider errors, preserve dirty drafts on disconnect, and model
  ambiguous writes without blind retry.
- [ ] Commit root/context changes transactionally and remove generic bypasses.

### Optional services

- [ ] Route Git/path/CLI only when declared; otherwise show unavailable.
- [ ] Keep recording at the server stream boundary and terminal-output activity
  universal while gating agent journals/process observation.
- [ ] Prevent local MCP sockets and local provider paths entering remote shells;
  route macro file fields through the environment.

## Acceptance checks

- Sentinel paths/commands in two environments never cross adapters or fall back
  to This server.
- Missing provider/capability leaves project/panels represented with typed state.
- Existing terminal recovery, recording, activity, file, and Git suites pass
  through This server routing.
- Provider transport loss scopes interruption/drafts/status correctly.

## Definition of done

No privileged project service chooses its machine from client input or a global
server-host adapter; required/optional capability behavior is testable.
