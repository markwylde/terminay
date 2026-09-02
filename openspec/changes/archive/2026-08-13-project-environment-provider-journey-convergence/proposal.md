## Why

The installed-provider UI gaps left by the project environment and extension UI
work, the SSH journey work, and the Puzed journey work had been accepted
incorrectly: the project chooser offered no real provider creation actions, and
provider-backed Puzed form options did not function through the selected
Terminay Server.

## What Changes

- Add and validate the fixed client `project-environments.resolve-options`
  operation covering provider, profile, source, current values, query, and
  abort.
- Load and refresh asynchronous form options with explicit loading, empty, and
  provider-error states so a provider select is never inert.
- Project the selected server's providers and profiles into the project chooser
  with direct **New SSH** and **Create new Puzed VM** actions.
- Keep the Project Environments sidebar and selected-server authority while
  opening the requested profile or environment form directly.

## Capabilities

### New Capabilities
- _None._

### Modified Capabilities
- `project-environments`: server-resolved dynamic form options and provider
  creation actions in the project chooser.

## Impact

The `project-environments` protocol operation set, the client environment
option resolution path, the project chooser and Project Environments sidebar,
and the native and browser intent routing for provider forms.
