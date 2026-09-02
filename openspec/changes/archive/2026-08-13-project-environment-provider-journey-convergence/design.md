## Context

See proposal.md. This change is a correction: three earlier changes were marked
complete while an installed provider was not actually usable from the project
chooser. The intent here is convergence on the already-specified journey, not
new scope.

## Goals / Non-Goals

Goals:
- An installed SSH or Puzed provider is immediately usable from the project
  chooser.
- Provider form fields whose options come from the server populate and react to
  their dependencies.

Non-Goals:
- Changing environment ownership. The selected Terminay Server remains the sole
  authority for providers, profiles, and environments.

## Decisions

- **A fixed operation, not a provider-defined RPC.**
  `project-environments.resolve-options` is a fixed, validated client operation
  carrying provider, profile, source, current values, and query, with abort
  support. Providers supply option data through it rather than through
  arbitrary client-callable endpoints.
- **No inert selects.** Asynchronous option loading has explicit loading,
  empty, and provider-error states, so a select never renders as an empty
  control with no explanation.
- **Chooser actions derive from the server snapshot.** The chooser projects the
  selected server's providers and profiles and offers the direct **New SSH** and
  **Create new Puzed VM** actions from that snapshot, opening the requested
  profile or environment form directly while the Project Environments sidebar
  and selected-server authority remain unchanged.

## Risks / Trade-offs

- Server-resolved options add a round trip to form interaction; abort support
  and dependency-scoped requests keep that bounded.
- Tests had to cover hostile and stale provider DTOs explicitly, since option
  data originates from an installed extension.
