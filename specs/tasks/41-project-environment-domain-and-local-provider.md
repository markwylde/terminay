# Project environment domain and This server provider

## Goal

Introduce the canonical environment/profile repository, immutable project
binding, transport-bound authorization, and built-in This server provider
without changing current Local behavior.

## Delivery phase

Phase 1 foundation, in parallel with [Task 42](./42-extension-api-manifest-and-host.md).

## Governing specifications

- [Project environments](../features/project-environments.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)
- [Server-owned project environments](../decisions/server-owned-project-environments.md)

## Current gap

Workspace schema equates one server with one machine, projects have no
environment identity, some object-derived panel commands escape complete
project-claim checks, and application auth trusts client hello identity/scope in
production compositions.

## Parallel work streams

### Domain, persistence, and migration

- [ ] Define runtime-validated environment/profile/revision/capability/status
  records and a revisioned, crash-safe repository separate from workspace.
- [ ] Reserve the undeletable This server environment and migrate every legacy
  project/session idempotently without changing layouts or identities.
- [ ] Advance workspace/protocol/client reconciliation with immutable project
  environment and matching terminal-session metadata.

### Authorization and workspace invariants

- [ ] Bind actor/scope/project claim/explicit permissions to authenticated
  transports rather than `ClientHello`; cover embedded, standalone, and tests.
- [ ] Derive source/destination project scope for every workspace mutation,
  including panel create/update/close/move and generic project update.
- [ ] Reject cross-environment panel moves before mutation and make generic
  project updates presentation-only; root changes use the prepared command.

### Built-in provider and conformance

- [ ] Define the internal environment registry/router contract and implement
  This server using existing terminal/filesystem/Git/shell services.
- [ ] Add capability/status queries and bounded safe presentation DTOs.
- [ ] Prove existing Local launch, files, Git, recording, agents, MCP, macros,
  project moves, reconnect, and server restart are unchanged.

## Acceptance checks

- Schema-v2 fixtures migrate once to This server and preserve all ids/state.
- Forged client id/admin and incomplete project claims cannot manage or mutate
  unrelated environment/project objects.
- A project/session environment mismatch and cross-environment panel move fail
  atomically before process, file, or workspace mutation.
- This server passes existing server-core tests with no second Local authority.

## Definition of done

One canonical environment domain and safe This server adapter are production
authorities, migrations/recovery are tested, and all project operations can be
resolved through a stable environment identity without enabling npm providers.
