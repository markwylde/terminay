## Why

The workspace schema equated one server with one machine, so projects had no
environment identity at all. Some object-derived panel commands escaped
complete project-claim checks, and production compositions still trusted the
identity and scope a client asserted in its `ClientHello`. Nothing could be
routed to another machine until a canonical environment domain existed.

## What Changes

- Define runtime-validated environment, profile, revision, capability, and
  status records in a revisioned, crash-safe repository kept separate from
  workspace state.
- Reserve an undeletable **This server** environment and migrate every legacy
  project and session to it idempotently, without changing layouts or
  identities.
- Carry immutable project environment and matching terminal-session metadata
  through workspace, protocol, and client reconciliation.
- Bind actor, authorization scope, project claim, and explicit permissions to
  the authenticated transport rather than to `ClientHello`, across embedded,
  standalone, and test compositions.
- Derive source and destination project scope for every workspace mutation,
  including panel create, update, close, and move, and generic project update.
- Reject cross-environment panel moves before mutation; make generic project
  updates presentation-only so root changes use the prepared command.
- Define the internal environment registry and router contract and implement
  **This server** over the existing terminal, filesystem, Git, and shell
  services.
- **BREAKING** internally: a client's asserted identity or admin claim in
  `ClientHello` no longer confers authority.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `project-environments`: introduces the canonical environment domain, the
  reserved This server environment, immutable project binding, capability and
  status queries, and the routing contract.
- `server-owned-workspace-state`: authorization derives from the authenticated
  transport, and every workspace mutation resolves an explicit project scope.

## Impact

- New revisioned environment repository, separate from the workspace store.
- Schema-v2 workspace migration to the reserved This server environment.
- Application authentication in embedded, standalone, and test compositions.
- Workspace mutation dispatch for panel create/update/close/move and project
  update.
- No behaviour change for existing local projects, and no npm provider
  installation is enabled by this change.
