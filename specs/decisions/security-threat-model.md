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
| server UI bundle → client host | executable UI assets and protocol compatibility | manifest namespace, hashes, sizes, content types, and versions are verified before serving; host bridge checks origin/source/target/gesture |
| vault/migration/logging → operators | provider secrets, safe-storage material, migration backups, diagnostics | only metadata crosses transport; secret bytes are scoped to privileged callbacks, zeroized, redacted, and never logged |

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

## Release evidence required

Release review must retain deterministic protocol/boundary fuzz results,
dependency and native-runtime provenance, SBOM/manifest hashes, redacted
support-bundle output, and clean-install/upgrade/recovery evidence. Any
unverified remote TURN, signing, or native-platform claim remains an explicit
release blocker rather than a passed checklist item.
