## Why

Upgrading Pop Terminay from a phone left the progress card on **Installing** for good, and reopening the app showed it again. The upgrade had worked: the server restarted on the new Canary build at 07:44:05 and its upgrader recorded success at 07:44:10. The card was stuck on a second attempt that should never have been offered, and nothing could observe that attempt ending.

The upgrade has no identity anywhere. The server writes a request file for a root helper it cannot watch. The helper writes an outcome only when it moves the active release. The server and every client then guess how an attempt ended from timestamps, version strings, and deadlines. Each guess failed here:

- The restarted server read its install record before the upgrader had rewritten it, so it offered the build it was already running. Rolling builds share one version string (`6.10.0-main.3493.canary` named both b2a60196 and b2fd47fb), so nothing could tell the two apart.
- The second request reached the helper, which found nothing to do, exited, and recorded nothing. The server stayed "in progress" until its 30-minute deadline, and the client's **Installing** step has no deadline of its own.
- The client decides endings from versions and outcome times. With equal version strings, that logic can also report success before anything was installed.

Earlier fixes added more inference to each of these places. This change replaces that inference with an attempt that has an identity from the device's request to the outcome every client reads.

## What Changes

- **The server owns each attempt.** An accepted start creates an attempt with a server id, the requesting device's request id, the mode, the start time, an absolute expiry, and the release it starts from (version and revision). The server persists the attempt in its data root before the handover. The server running after a restart takes the attempt up, keeps it after it ends as the last attempt, and reports it, until the next attempt replaces it.
- **The upgrader reports every mutating run under a run id and an install-wide lock.** Every `daemon upgrade` run that may change the install takes an install-wide lock. It records a start with its own run id, then exactly one ending under that run id: succeeded, rolled back, unchanged (already current), or failed with nothing changed. A container recreate records its ending only after the replacement's health verdict. The root helper still ignores the request file's contents. `daemon upgrade --check` stays read-only.
- **The server binds and watches.** While an attempt is pending, or while its install record names another revision, the server watches the install's record directory. The first run that starts after the attempt is bound to it, and only that run's ending ends it. One-shot deadlines bound every stage and the whole attempt, and a server restart never extends them. An attempt whose expiry passes without an ending fails, saying how it ended is unknown. The server never infers success from a revision change.
- **Builds are compared by revision.** The server never offers the build it runs, offers nothing from a stale install record, and checks again as soon as the record is rewritten. The release check reports a rolling build's revision.
- **Attempts are a new protocol surface.** A server advertises `server.upgrade.attempts` and publishes the attempt through its own query and event. The existing upgrade status keeps its exact shape, so released clients keep working.
- **Clients follow an attempt by id.** The requesting device sends a request id and binds to the attempt that carries it, even if the start reply is lost. The card's steps come from the attempt's stage and the connection's phase. It ends on the attempt's own ending, or on a connection-level ending. Against a server without attempts (older, or reached by a downgrade), the client keeps its current rules for that server only. This replaces the progress-card contract's version and time rules.

## Capabilities

### New Capabilities

None. `server-upgrade` is introduced by changes still awaiting archive; this change adds to it.

### Modified Capabilities

- `server-upgrade`: attempts with identity, persistence, binding to one upgrader run, stage and absolute deadlines, a protocol surface of their own, and revision comparison.
- `daemon-cli`: `daemon upgrade` serialises runs install-wide and records a start and one ending for every mutating run, under a run id. Recreate records after the health verdict.
- `connections-and-client-hosts`: the progress card follows one attempt by id. The requirement "Confirming and following a server upgrade" is modified, so this change archives after `remote-server-in-app-upgrade`, `server-upgrade-progress-checklist`, `install-latest-on-channel`, `server-check-for-updates-on-request`, and `upgrade-status-names-real-versions`.

## Impact

- `packages/protocol`: `server.upgrade.attempts` capability, `server.upgrade.attempt` query and event, attempt types and parser, and an optional `requestId` on the start request, sent only to servers with attempts. The status type is unchanged.
- `packages/server-core/src/serverUpgrade`: attempt ownership, persistence, binding, watching, deadlines, revision comparison, and the attempt operations.
- `packages/client-core`: an attempt store on `ServerUpgradeClient`.
- `apps/terminay-server/src/releaseUpgrader.ts`, `cli.ts`: record parsing and watching, the attempt store in the data root, and the server's revision.
- `apps/terminay-cli/src/outcome.ts`, `layout.ts`, `commands/upgrade.ts`, `commands/check.ts`, `commands/containerUpgrade.ts`, `commands/recreate.ts`: run records, the install lock, record ordering, and revisions in the check report.
- `src/workspace/serverUpgradeModel.ts`, `useServerUpgrades.ts`, `SettingsServerUpdates.tsx`: follow by attempt id.
- No new dependency. No new privilege: the helper's request file stays content-blind, and the server reads files it can already read.
