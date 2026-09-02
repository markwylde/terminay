# Release install and update policy

This policy applies to the matched Terminay Desktop/server release topology.
It is the local recovery contract behind [Task 20](../tasks_completed/20-security-release-and-operations.md)
and complements the [standalone server runbook](./standalone-server.md).

## Independent update targets

- `desktop-host` updates Terminay Desktop and its embedded, matched server/UI
  payload. It may restart the embedded local server as part of that host
  update.
- `standalone-server` updates only the explicitly selected local standalone
  installation and its matched UI/protocol payload.
- A remote server is never an implicit update target. Desktop and browser
  clients may report that a remote server is incompatible, but only an
  explicit operator action on that server may install its artifact.

An update carries product, artifact, server, UI, and protocol versions. The
host validates those fields and the artifact manifest before activation. A
candidate with an incompatible protocol or matched UI/server version is
rejected while the current artifact remains active.

## Install, upgrade, and rollback

1. Verify the artifact checksum, signature/provenance metadata, target
   platform, and version output before staging it.
2. Stop the foreground standalone process or let the Desktop supervisor own
   the embedded restart. Do not run two authorities against one data root.
3. Stage the candidate in a new versioned directory and atomically move the
   active pointer only after validation succeeds.
4. Preserve the same data root and stable server identity across an upgrade.
5. Keep the previous artifact and a complete data-root backup until the new
   version passes readiness and smoke checks.
6. Roll back by restoring the previous artifact and a validated backup/root;
   never overwrite the only failed root.

The deterministic local lifecycle harness is
`scripts/task20-release-lifecycle.mjs` with coverage in
`scripts/task20-release-lifecycle.test.mjs`. It proves state-transition and
boundary behavior only; it does not claim that macOS notarization, Linux
package installation, or platform-specific signed-artifact execution has run.

## Failure recovery

An incompatible candidate, failed readiness check, or interrupted activation
must leave the prior artifact selected and the data root/identity unchanged.
Operators preserve the failed artifact and logs for diagnosis, then retry or
roll back from the validated copy. A server-process crash is a recovery event,
not permission to create a second server authority.
