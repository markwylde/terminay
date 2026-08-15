# Terminay security threat model

This review records the trust boundaries for the server/client topology. It is
an engineering contract for release review, not a claim that hostile hosts or
untrusted provider binaries become safe by themselves.

## Assets and trust boundaries

| Boundary | Protected assets | Required invariant |
| --- | --- | --- |
| Desktop bootstrap → embedded Server | data-root lease, endpoint, bootstrap credential, server identity | one authority owns the root and endpoint; readiness is published only after the lease and runtime are live |
| local control socket → Server | per-terminal MCP token, project/session scope, terminal input/output | tokens are opaque, bounded, revocable, and resolve to immutable server/project/session state; no PID or renderer fallback |
| Server ↔ provider hooks | provider lifecycle state and hook token | loopback-only, exact session binding, bounded canonical fields, replay/order fences, no provider secret in snapshots |
| Server filesystem/Git services → project root | project files, drafts, recordings, Git credentials | canonical paths and opaque ids are revalidated at mutation time; traversal, symlink escape, dirty/main deletion, and stale revisions fail closed |
| Server ↔ remote device/WebRTC | device keys, PIN/approval, reconnect grants, application data | admission follows proof and origin checks; channels are bounded and revoked peers are closed; application data never enters manager storage |
| server UI bundle → client host | executable UI archive and protocol compatibility | the server is authenticated before transfer; archive paths remain within its exact session-origin bundle namespace and bounded extraction limits apply; host bridge checks origin/source/target/gesture |
| vault/migration/logging → operators | provider secrets, safe-storage material, migration backups, diagnostics | only metadata crosses transport; secret bytes are scoped to privileged callbacks, zeroized, redacted, and never logged |
| authenticated client → extension/environment management | server-account code, profiles, host trust, infrastructure | actor/scope come from the authenticated transport; explicit permissions, revisions, confirmations, and audit gate every privileged action |
| npm registry → extension installer | server runtime and data root | exact npmjs version/integrity, sterile config, scripts disabled, bounded lock/tree validation, atomic activation, and rollback |
| Server → extension child | workspace authority, broker APIs, other extensions | namespaced bounded IPC, minimal environment, deadlines, crash isolation, no raw Server Core or cross-extension secrets |
| project → environment adapter | PTYs, files, Git, agents, MCP | the server derives immutable environment routing from canonical project state; copied ids/paths/labels cannot redirect and failures never fall back Local |
| Server → SSH/Puzed endpoints | credentials, host identity, VMs | scoped vault resolution, strict SSH trust by default, bounded HTTPS/same-origin authorization, idempotent lifecycle, and redacted errors |

## Threats and mitigations

- A copied local token, forged PID, or renderer request cannot widen a
  capability. The local endpoint authenticates the token digest, rechecks
  expiry/revocation, and derives the implicit project from the server-owned
  session.
- A second embedded server cannot reuse the data root or endpoint. Bootstrap
  claims both leases before publishing readiness and releases both on failure.
- A stale client cannot overwrite files, Git worktrees, settings, macros, or
  metadata. Mutations carry revisions/heads and revalidate canonical identity
  immediately before the write.
- A malicious or compromised provider hook cannot inject arbitrary provider
  text. The receiver accepts loopback requests only, normalizes a bounded
  canonical event, and fences reordered, exited, cross-scope, and oversized
  updates.
- A remote peer cannot use a manager origin or an expired/revoked proof to
  reach application channels. Device/PIN/approval verification precedes
  admission, channel identity is exact, and revocation closes active sessions.
- A hostile bundle or host page cannot escape its route. Bundle paths are
  namespace-bound and hash-verified; browser messages require exact origin,
  source, target window, validated payload, and user gesture where applicable.
- A vault or migration failure cannot disclose plaintext. Backups contain
  redacted metadata, marker state is resumable without secret values, and
  `withSecret` exposes only a zeroized scoped copy inside server code.
- A custom npm extension is trusted code with the Terminay Server account's
  effective authority. Child-process and broker boundaries contain normal
  crashes/API mistakes but are not represented as a hostile-code sandbox.
- A forged client hello cannot grant extension/environment administration.
  Actor, scope, project claim, and explicit permissions come from the
  authenticated transport/device record and object-derived project checks cover
  source and destination mutations.
- A remote path, host, environment id, or extension failure cannot cause a
  project operation to execute on the server host. The canonical project
  binding is resolved before capability dispatch and cross-environment moves
  fail before mutation.

## Release evidence required

Release review must retain deterministic protocol/boundary fuzz results,
dependency and native-runtime provenance, SBOM/manifest hashes, redacted
support-bundle output, and clean-install/upgrade/recovery evidence. Any
unverified remote TURN, signing, or native-platform claim remains an explicit
release blocker rather than a passed checklist item.
