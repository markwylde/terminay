## Context

See proposal.md. This was the Phase 1 foundation, delivered in parallel with the project
environment domain and local provider work, and depended on by the environment-routed
project services and extension management changes that followed.

## Goals / Non-Goals

Goals:
- A narrow, versioned public contract that third-party providers can build against.
- Fault isolation: an extension failure must not affect the server or another provider.
- The same contract in embedded Desktop and standalone headless servers.

Non-Goals:
- npm installation and extension management UI, which are separate changes.
- Official provider implementations.
- Any renderer-executed extension code.

## Decisions

- **One child process per extension, launched with bundled Node.** Communication is private
  framed IPC with a minimal environment and cwd, bounded admission, bounded message sizes,
  timeouts, an explicit shutdown sequence, and crash-loop control. This is the fault
  isolation boundary: an extension cannot block server or This server readiness.
- **The exposed surface is enumerated, not inherited.** An extension host object exposes
  only namespaced config, data, and cache; scoped logging and scoped vault resolution;
  provider registration and dependency calls; cancellation; and lifecycle callbacks. A child
  cannot register a core operation or resolve another extension's secret.
- **Validation happens before import.** Manifest, entrypoint, API version, engine, platform,
  and declared dependencies are validated, and unknown, colliding, or path-escaping inputs
  are rejected, before any extension module is imported.
- **UI contributions are declarative and bounded.** Forms, options, cards, progress, and
  actions are described as data. No renderer code, raw HTML, or arbitrary assets cross the
  boundary; Desktop and web receive schemas and status only.
- **Authorization comes from the transport.** The acting actor and permissions are derived
  from the authenticated transport, and every admin mutation is revisioned and audited
  without recording secret values.
- **Both runtime modes share one secret-broker contract.** Embedded and headless vault
  composition and unlock were completed together so a provider behaves identically in a
  Desktop-embedded server and a standalone one.

## Risks / Trade-offs

- Extensions remain trusted Node programs; isolation bounds blast radius and cross-extension
  access, but is not a sandbox against a deliberately malicious trusted extension.
- Hostile fixtures — incompatible, malformed, oversized, late-IPC, colliding, crashing, and
  cross-extension secret-denial cases — were added specifically because the boundary claims
  are only credible if they are exercised.
