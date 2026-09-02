## Context

See proposal.md. This was Phase 2 work, running in parallel with extension installation and
management and the project environment UI, and depending on the Phase 1 project environment
domain and local provider work and the extension API, manifest, and host work.

## Goals / Non-Goals

Goals:
- No privileged project service chooses its machine from client input or a global
  server-host adapter.
- Required and optional capability behaviour is explicit and testable.
- Existing terminal, recording, activity, file, and Git behaviour is preserved when the
  project runs on This server.

Non-Goals:
- Retargeting an existing project to a different environment.
- Changing session, stream, attachment, or presentation contracts.

## Decisions

- **Routing derives from canonical project state.** The environment is resolved from the
  project record, not from an environment id, hostname, or path supplied by a client.
- **Optional services are declared, not probed.** Git, path, and CLI services run only where
  the environment declares them; otherwise the surface reports unavailable with typed state
  rather than degrading to the server host.
- **Server-local variables stop at the remote boundary.** MCP socket paths, control
  variables, and provider-local paths are filtered out of launch environments for remote
  environments so a remote shell cannot reach server-local services.
- **Recording stays at the server stream boundary.** Recording and terminal-output activity
  are universal because they observe the server-owned stream; agent journals and process
  observation are gated because they require host access.
- **Writes are modelled, not blindly retried.** Provider errors are normalized, dirty drafts
  survive a disconnect, and ambiguous writes are represented as ambiguous rather than retried
  automatically. Root and context changes commit transactionally.

## Risks / Trade-offs

- Removing generic bypasses means a provider outage leaves projects and panels visibly
  degraded rather than quietly working against the wrong machine; that is the intended
  behaviour and is asserted with sentinel paths and commands in two environments.
- Capability gating adds explicit unavailable states to surfaces that previously always
  worked, which is a visible change for environments that do not declare those capabilities.
