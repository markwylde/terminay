## Context

A server upgrades itself by handing the work to the upgrader its release ships (ADR-0062). Each install type hands over differently:

- **User scope and container:** the server spawns `daemon upgrade` detached.
- **System scope:** the server writes a request file. A root-owned path unit starts a oneshot that runs `daemon upgrade --system`. The oneshot ignores the file's contents, and that is the privilege boundary between the run-as account and root.

How an attempt ended is known from one record, `upgrade-result.json`, in the install prefix beside `install.json`. Today:

- The record is written only by runs that move, or try to move, the active release.
- The server reads it only during a channel check, and skips checks while an attempt is in progress.
- After a restart, the new server gets no identity for the attempt. It and every client match outcomes by timestamp and decide endings by comparing version strings.
- The install record is rewritten only after the new server reports ready, so the new server's first check describes the release it replaced. Rolling builds share one version string.
- The status parser on every released client is strict: an unknown field rejects the whole status.

Together these produced the stuck card: a second, no-op attempt offered from a stale record, ended by nothing.

## Goals / Non-Goals

**Goals:**

- One attempt identity, owned by the server, from the device's request to the ending every client reads, surviving any number of restarts.
- Every mutating upgrader run leaves a start and one ending, correlated to the attempt by run id rather than by time alone.
- Every stage observable and bounded on the server. Clients render state; they do not infer it.
- Builds told apart by revision.
- Released clients keep working against new servers, and new clients against released servers.

**Non-Goals:**

- Changing what the helper may do, how it is triggered, or which release it chooses.
- Changing the card's look or the confirmation's content.
- Upgrading the embedded Local server.

## Decisions

### 1. The server owns the attempt and keeps it in its data root

An accepted start creates:

```
{ id, requestId?, mode, kind: 'upgrade' | 'install-latest', startedAt, expiresAt = startedAt + 30 min,
  from: { channel, version, revision }, run?: { id, startedAt },
  ending?: { kind, from, to, reason?, at } }
```

The id is a random UUID. The server writes it to `server-upgrade-attempt.v1.json` in the data root, with the atomic replace used for other server state, before it triggers. A failed write refuses the start. One mutex in the service serialises start, persist, and trigger, so two starts cannot both persist.

The file is kept after the ending, as the last attempt, and replaced by the next start. A server that starts reads it:

- **Pending:** taken up and reported.
- **Ended:** reported as the last attempt.
- **Malformed:** ignored with a diagnostic.

*Boundary:* the data root is the server's own state. Nothing in the attempt reaches the root helper.

*Alternative rejected:* carry the attempt id through the request file. That would need the root oneshot to read content the run-as account controls. Run ids (decision 2) give the correlation without crossing that boundary.

### 2. The upgrader records every mutating run under a run id, behind an install lock

`daemon upgrade` (in place, recreate, install-latest, container in-place) takes `upgrade.lock` in the install prefix. It creates the lock exclusively, holding the process id and start time. A lock whose process is gone is taken over. A held lock means the run exits non-zero with "another upgrade is running" and writes nothing. `--check` takes no lock and writes nothing.

Inside the lock, the run chooses a run id (UUID). It writes `started { run, at, from: release }` before resolving the channel. It then writes exactly one ending with the same `run`:

- `succeeded`: written right after readiness. Install-record rewrite, pruning, and host setup follow; their failures are logged and do not replace the success.
- `rolled-back`: written by the existing restore paths.
- `unchanged`: both already-current branches, with `from` and `to` naming the running release.
- `failed`: any error before the active release changed, with the reason.

The outer wrapper writes `failed` only if this run has written no ending. An error after activation but before readiness goes through the existing restore, which records `rolled-back`.

Releases in records are structured `{ channel, version, revision }`, alongside the existing `from` and `to` labels kept for readers that predate this change. Each write uses a unique temporary name and then renames. The record keeps schema version 1. A reader that does not know `started`, `unchanged`, or `failed` treats the record as absent, as before.

Container recreate (`runContainerRecreateHelper`) moves its success write after `startAndAwaitHealthy()`. A failed health verdict restores the previous container and records `rolled-back`. No success is ever written first.

### 3. The server binds a run and watches the record

The check report gains `recordPath`. The host upgrader adds two methods:

- `readRecord()`: strict parse of every kind.
- `watchRecord(listener)`: `fs.watch` on the record's directory, filtered to the record's name and `install.json`, because both are replaced by rename.

The service keeps the watch armed while an attempt is pending or the install record is stale (decision 5). On arming it reads once, so a change made in between is not missed. On a change:

- A `started` at or after the attempt's `startedAt`, while no run is bound: bind `run`, persist, stage `installing` (or `finishing` on a server started after the bind).
- An ending whose `run` is the bound run: end the attempt with it, persist, publish, then check the channel.
- An ending from another run, or an older record: ignored.
- An `install.json` change: a channel check.

A spawned upgrader's exit triggers one `readRecord()`. If the bound run (or, with none bound, any run started after the attempt) has no ending, the attempt ends as failed: "the upgrader exited without recording how it ended".

A new start is refused (`in-progress`) while the record holds a `started` younger than 30 minutes with no ending. A run is then in flight on the host, possibly an operator's.

If the watch cannot be armed, a diagnostic is logged, and the attempt still ends at its deadlines and on a spawned upgrader's exit. This follows ADR-0028 (which supersedes ADR-0022): a file change is observed by a watch, and nothing is polled.

At startup, the record's path is known only after the first check. The service runs that check at once when it has a pending attempt or a stale record, and arms the watch from its report. Until then it reports the attempt as persisted.

### 4. Deadlines are absolute and persisted

All deadlines are one-shot timers derived from the persisted `startedAt` and `expiresAt`, so a restart re-arms them for the time remaining and never extends them:

- **No bound run 2 minutes after `startedAt`:** failed, "the upgrader did not start", naming `sudo terminay daemon upgrade --system` (system scope) or the scope's equivalent.
- **Still pending at `expiresAt`:** failed, "the upgrader did not report how it ended; the server now runs <version> (<revision>)".

The server never reports success without the bound run's `succeeded`. A changed revision without a record is reported as unknown, never as success.

A recovered attempt keeps its stage semantics:

- with no bound run, it stays `requested`;
- with a bound run, a server started after the bind reports `finishing`.

### 5. Revision is the build's identity

The service receives `serverRevision` (`TERMINAY_SERVER_REVISION`, set by the launcher).

- **Install record revision ≠ `serverRevision`:** the record is stale. `available` and `latest` are withheld, the watch is armed, and `clientAttached` checks whenever the record is stale, regardless of the hourly freshness gate.
- **`available.revision` = `serverRevision`:** nothing is available.

`findAvailable` adds the peeked revision to `available` and `latest` for rolling builds in the newer and older branches.

### 6. Attempts are their own protocol surface

Released clients reject unknown status fields, so the status keeps its exact shape. A new capability `server.upgrade.attempts` comes with:

- query `server.upgrade.attempt` → `{ attempt: ServerUpgradeAttempt | null }`;
- event `server.upgrade.attempt`, appended to the shared journal on every change;
- `ServerUpgradeAttempt = { id, requestId?, mode, kind, startedAt, expiresAt, stage?, ending? }`, where `stage` is `requested | installing | finishing` and `ending` is `{ kind: succeeded | rolled-back | unchanged | failed, from, to, reason?, at }`, with versions shown to people.

The start request accepts an optional `requestId`, a bounded token. A client sends it only to a server advertising the capability, because a released server's strict request parser would reject it. The start reply stays the status, and the client reads the attempt by request id.

The legacy status keeps reporting `in-progress` while an attempt is pending, and the ended attempt as its outcome:

- `unchanged` → `succeeded` with `from` equal to `to`;
- `failed` → `failed`, `restored: true`, with the reason, because the running release is the one that was running.

The new parser has tests that run the released status parser against a new server's statuses.

### 7. The client follows by attempt id

`ServerUpgradeClient` gains an attempt store, subscribed only when the server advertises the capability. The board keeps per server:

- the attempt it follows (id, request id, target, mode), in memory and in device storage;
- whether the connection dropped while following.

Starting from the menu or from Settings (`SettingsServerUpdates.tsx`, including Install latest) goes through one board call that:

1. records `{ requestId, target, mode, initiated }`;
2. sends the start;
3. binds to the attempt carrying that request id, whenever it arrives.

Other behaviour:

- A late reply for a request id whose attempt has ended changes nothing.
- Another device follows a pending attempt it reads.
- Steps come from the stage and the connection's phase.
- Endings come from the attempt's `ending`, plus the connection-level endings: the reconnect deadline while the server is away, and incompatible on return.
- A server that returns without the capability, or never had it, is followed by the existing rules. Those rules are kept in one function used only for such servers.

### 8. Downgrade and rollback into a release without attempts

When install-latest moves a server to a release without attempts, or the upgrade rolls back to one, the returning server neither advertises nor reads attempts. The client switches to the server-without-attempts rules (decision 7) when it sees the capability missing, so the card still ends by the existing rules. The attempt file stays in the data root. If a release with attempts starts later and finds it:

- **Pending and past `expiresAt`:** it ends it as failed (unknown) without arming anything.
- **Pending and not yet expired:** it is handled normally.

A device that is not following an attempt never opens a card for an ending it reads.

## Risks / Trade-offs

- [The helper is killed between `started` and its ending] → The attempt ends at `expiresAt` as failed (unknown), with the release now running named.
- [`fs.watch` misses an event on some filesystem] → Reads on arming, on a spawned upgrader's exit, and at each deadline keep the attempt bounded.
- [An operator's run holds the lock when the helper fires] → The helper exits without a record, and the attempt fails at two minutes as "did not start". Starts are refused while a fresh unended `started` is on record, which covers most of this window.
- [A lock left by a crashed process] → Taken over when its process id is not running. A recycled process id can block one upgrade until the operator removes the file. The error names the file.
- [Clock skew] → Record and attempt times come from the same host's clock, or the same container's.

## Migration Plan

The upgrader that runs is the one in the installed release. So:

- **The first upgrade from a release without this change** runs under the old rules end to end. The new server it starts has no attempt file and a stale install record, which decision 5 handles: nothing is offered until the record names the new revision, seconds later.
- **Later upgrades** use attempts.
- **Clients:** released clients read the unchanged status. New clients use attempts only where the capability is advertised.
- **Rollback to an older release:** see decision 8.

## Open Questions

None. ADR-0062, ADR-0028, and ADR-0117 stand.
