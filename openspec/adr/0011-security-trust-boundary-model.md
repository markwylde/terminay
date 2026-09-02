# ADR-0011: Adopt an explicit trust-boundary model as the security contract for release review

Status: accepted
Date: 2026-07-27

## Context

The server/client topology crosses many boundaries: Desktop bootstrap to
embedded server, local control socket, provider hooks, filesystem and Git
services, remote WebRTC devices, hosted signaling, the server UI bundle, the
vault, extension management, the npm registry, extension children, project
environment adapters, and SSH and provider endpoints. Without a single written
model, each boundary is reviewed ad hoc, and it becomes impossible to say what a
given release has actually proven.

This record is an engineering contract for release review. It is not a claim that
hostile hosts or untrusted provider binaries become safe by themselves.

## Decision

The following boundaries, protected assets, and required invariants are the
security contract. Every release review is conducted against this table.

| Boundary | Protected assets | Required invariant |
| --- | --- | --- |
| Desktop bootstrap → embedded Server | data-root lease, endpoint, bootstrap credential, server identity | one authority owns the root and endpoint; readiness is published only after the lease and runtime are live |
| local control socket → Server | per-terminal MCP token, project/session scope, terminal input/output | tokens are opaque, bounded, revocable, and resolve to immutable server/project/session state; no PID or renderer fallback |
| Server ↔ provider hooks | provider lifecycle state and hook token | loopback-only, exact session binding, bounded canonical fields, replay/order fences, no provider secret in snapshots |
| Server filesystem/Git services → project root | project files, drafts, recordings, Git credentials | canonical paths and opaque ids are revalidated at mutation time; traversal, symlink escape, dirty/main deletion, and stale revisions fail closed |
| Server ↔ remote device/WebRTC | device keys, PIN/approval, reconnect grants, application data | the fragment authenticates and pins the first host key; every generation binds the pinned key and fresh client nonce to the offered DTLS fingerprints before credentials or data; channels are bounded and revoked peers are closed |
| Server ↔ hosted signaling | session host registration, offers, answers, ICE, server host public key | signaling is untrusted for confidentiality and integrity; host registration and client-verified transport transcripts prevent endpoint substitution, credential relay, and two-peer proxying; compromise can cause only bounded denial of service |
| server UI bundle → client host | executable UI archive and protocol compatibility | the server is authenticated before transfer; archive paths remain within its exact session-origin bundle namespace and bounded extraction limits apply; host bridge checks origin/source/target/gesture |
| vault/migration/logging → operators | provider secrets, safe-storage material, migration backups, diagnostics | only metadata crosses transport; secret bytes are scoped to privileged callbacks, zeroized, redacted, and never logged |
| authenticated client → extension/environment management | server-account code, profiles, host trust, infrastructure | actor/scope come from the authenticated transport; explicit permissions, revisions, confirmations, and audit gate every privileged action |
| npm registry → extension installer | server runtime and data root | exact npmjs version/integrity, sterile config, scripts disabled, bounded lock/tree validation, atomic activation, and rollback |
| Server → extension child | workspace authority, broker APIs, other extensions | namespaced bounded IPC, minimal environment, deadlines, crash isolation, no raw Server Core or cross-extension secrets |
| project → environment adapter | PTYs, files, Git, agents, MCP | the server derives immutable environment routing from canonical project state; copied ids/paths/labels cannot redirect and failures never fall back Local |
| Server → SSH/Puzed endpoints | credentials, host identity, VMs | scoped vault resolution, strict SSH trust by default, bounded HTTPS/same-origin authorization, idempotent lifecycle, and redacted errors |

### Threats and required mitigations

- A copied local token, forged PID, or renderer request cannot widen a
  capability. The local endpoint authenticates the token digest, rechecks expiry
  and revocation, and derives the implicit project from the server-owned session.
- A second embedded server cannot reuse the data root or endpoint. Bootstrap
  claims both leases before publishing readiness and releases both on failure.
- A stale client cannot overwrite files, Git worktrees, settings, macros, or
  metadata. Mutations carry revisions and heads and revalidate canonical identity
  immediately before the write.
- A malicious or compromised provider hook cannot inject arbitrary provider text.
  The receiver accepts loopback requests only, normalizes a bounded canonical
  event, and fences reordered, exited, cross-scope, and oversized updates.
- A remote peer cannot use a manager origin or an expired or revoked proof to
  reach application channels. Device, PIN, and approval verification precedes
  admission, channel identity is exact, and revocation closes active sessions.
- A stranger who knows a public session hostname cannot become the WebRTC host.
  Signaling admits device-host registration only with proof of the registered
  server host key, and a different key does not overwrite a live registration.
- A malicious signaling or TURN service cannot terminate and proxy separate
  client and server WebRTC connections. First pairing authenticates the host key
  and transport transcript with fragment-derived key material; reconnect uses that
  pinned host key. The transcript covers a fresh client nonce and the offered DTLS
  fingerprints, and verification precedes every PIN, device signature, ticket,
  bundle, and application frame.
- A hostile bundle or host page cannot escape its route. Bundle paths are
  namespace-bound and hash-verified; browser messages require exact origin,
  source, target window, validated payload, and user gesture where applicable.
- A vault or migration failure cannot disclose plaintext. Backups contain
  redacted metadata, marker state is resumable without secret values, and
  `withSecret` exposes only a zeroized scoped copy inside server code.
- A custom npm extension is trusted code with the Terminay Server account's
  effective authority. Child-process and broker boundaries contain normal crashes
  and API mistakes but are not represented as a hostile-code sandbox.
- A forged client hello cannot grant extension or environment administration.
  Actor, scope, project claim, and explicit permissions come from the
  authenticated transport and device record, and object-derived project checks
  cover source and destination mutations.
- A remote path, host, environment id, or extension failure cannot cause a
  project operation to execute on the server host. The canonical project binding
  is resolved before capability dispatch and cross-environment moves fail before
  mutation.

## Consequences

- Release review has a fixed checklist of boundaries rather than a per-release
  judgement call, and a new boundary must be added to this model before it can be
  shipped.
- The extension boundary is explicitly documented as crash isolation, not a
  hostile-code sandbox, so the product must not present it as one (see
  [ADR-0009](./0009-server-owned-project-environments.md)).
- Hosted signaling is treated as untrusted, which constrains the pairing and
  reconnect protocol design permanently rather than as a deployment option.

## Open items

Release review must retain deterministic protocol and boundary fuzz results,
dependency and native-runtime provenance, SBOM and manifest hashes, redacted
support-bundle output, and clean-install, upgrade, and recovery evidence. Any
unverified remote TURN, signing, or native-platform claim remains an explicit
release blocker rather than a passed checklist item.
