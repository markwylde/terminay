## 1. Convergence

- [x] 1.1 Add and validate the fixed client `project-environments.resolve-options` operation, including provider, profile, source, current values, query, and abort, verified by the client and server operation tests
- [x] 1.2 Load and refresh async form options with explicit loading, empty, and provider-error states so a provider select is never inert
- [x] 1.3 Project the selected server's providers and profiles into the project chooser with direct **New SSH** and **Create new Puzed VM** actions
- [x] 1.4 Preserve the Project Environments sidebar and selected-server authority while opening the requested profile or environment form directly
- [x] 1.5 Add focused client, UI, and server tests for option routing, stale and hostile DTOs, chooser actions, and native and browser intent routing

## 2. Acceptance checks

- [x] 2.1 Verify an installed SSH or Puzed provider is immediately usable from the project chooser
- [x] 2.2 Verify Puzed's server-backed fields populate and react to dependencies
- [x] 2.3 Verify the same journey passes through Desktop and browser hosts against embedded and standalone servers
