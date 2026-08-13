# Project environment provider journey convergence

## Goal

Close the installed-provider UI gaps that were incorrectly accepted by Tasks
45, 48, and 51: expose real provider creation actions in the project chooser
and make provider-backed Puzed options function through the selected Terminay
Server.

## Governing specifications

- [Project environments](../features/project-environments.md)
- [Puzed project environments](../features/puzed-project-environments.md)
- [Workspace and project tabs](../features/workspace-and-project-tabs.md)

## Checklist

- [x] Add and validate the fixed client `project-environments.resolve-options`
  operation, including provider/profile/source/current values/query and abort.
- [x] Load and refresh async form options with explicit loading, empty, and
  provider-error states; never leave a provider select inert.
- [x] Project the selected server's providers and profiles into the project
  chooser with direct New SSH and Create new Puzed VM actions.
- [x] Preserve the Project Environments sidebar and selected-server authority
  while opening the requested profile or environment form directly.
- [x] Add focused client/UI/server tests for option routing, stale/hostile DTOs,
  chooser actions, and native/browser intent routing.

## Definition of done

An installed SSH/Puzed provider is immediately usable from the project chooser,
Puzed's server-backed fields populate and react to dependencies, and the same
journey passes through Desktop/browser against embedded/standalone servers.
