# Unified renderer connection recovery

## Goal

Replace the web renderer's overlapping attempt gates, generation guard,
recovery loop, captured client callbacks, and panel-local recovery presentation
with one connection-scoped state machine shared by initial activation,
automatic recovery, and manual Retry.

## Governing specifications

- [Remote access](../features/remote-access.md)
- [Connections and client hosts](../features/connections-and-client-hosts.md)
- [Terminal stream congestion and recovery](../features/terminal-stream-congestion-and-recovery.md)
- [Server-owned workspace state](../features/server-owned-workspace-state.md)

## Dependency

- [Task 41: Single-owner WebRTC transport generations](./41-single-owner-webrtc-transport-generations.md)

## Current gap

`src/web/main.tsx` has multiple connection entry paths that independently
construct clients and contexts. `BrowserConnectionAttemptGate`,
`RendererConnectionGeneration`, `RendererConnectionRecovery`, React state, and
panel callbacks each own part of the lifecycle. Initial WebRTC pairing begins a
renderer generation with the transport origin but later disposes it by profile
id, so cleanup depends on which path mounted the same workspace.

The terminal Retry callback captures a specific client and renderer attempt.
Once correct disposal invalidates that attempt, the still-mounted button is
rejected as `stale-close-ignored`. In other paths, mismatched identity leaves
the generation current accidentally. Panel-local state can clear the visible
error before replacement transport and terminal attachment are usable.

## Architecture decisions

### One stable connection identity and controller

- [ ] Define one controller keyed only by stable profile id plus verified
  server/session identity. URL, origin marker, client id, React mount, and
  transport attempt are not alternative generation keys.
- [ ] Give the controller one monotonic attempt/generation sequence and one
  explicit state union covering idle, connecting, authenticating,
  resubscribing, hydrating, connected, retry-wait, blocked, and stopped.
- [ ] Make the controller own the active client/context, confirmed workspace
  and terminal watermarks, abort signal, retry timer, candidate disposal, and
  atomic activation. React only subscribes to its immutable state.
- [ ] Model transport acquisition as an injected host operation. WebRTC uses
  the Task 41 session host; direct WebSocket and Desktop MessagePort providers
  satisfy the same replacement interface without transport-specific branches
  in the renderer state machine.

### One activation and recovery path

- [ ] Complete pairing/enrollment before creating or updating the stable
  profile, then activate that profile through the same controller used for a
  remembered profile. Remove the separate connected-context construction
  branches.
- [ ] Route initial open, auto-restore, explicit profile selection, transport
  close, application-send failure, and Retry through controller events rather
  than directly constructing clients or starting nested recoveries.
- [ ] Dispose and fence the old client synchronously at generation retirement;
  fully authenticate, resubscribe, load the authoritative workspace, and
  hydrate terminal panels before publishing the candidate as connected.
- [ ] Preserve the mounted workspace presentation during recoverable failure,
  but never preserve its command authority. Explicit disconnect, forget,
  credential replacement, and profile switch unmount it deterministically.
- [ ] Make retries bounded per attempt with backoff but persistent across
  retryable failure. Manual Retry cancels the wait and starts a fresh current
  attempt immediately.

### Stable UI and terminal boundary

- [ ] Replace `requestConnectionRecovery` closures captured from a client with
  one stable controller `retry()` action supplied by current profile identity.
- [ ] Drive connection banners, terminal overlay, button availability,
  accessibility announcements, and input enablement solely from controller
  state plus terminal-attachment hydration state.
- [ ] Close and discard an uncertain terminal input queue immediately. Do not
  accept later keys until the new attachment is current; do not replay input
  whose delivery outcome is unknown.
- [ ] Keep the prior terminal emulator and confirmed render position, then
  resume/checkpoint-hydrate it against the replacement client exactly once.
- [ ] Clear recovery presentation only after the replacement attachment can
  deliver a probe/real command and receive its confirmed result.

### Delete superseded lifecycle code

- [ ] Delete `BrowserConnectionAttemptGate`, `RendererConnectionGeneration`,
  `RendererConnectionRecovery`, duplicated `recoverConnection` branches, and
  stale callback diagnostics after the unified controller owns their required
  invariants.
- [ ] Delete transport-specific auto-restore suppression, origin/profile key
  workarounds, fire-and-forget active-context disposal, and panel-local
  optimistic reconnect state.
- [ ] Replace source-regex tests for callback wiring with runtime state-machine
  and mounted-panel behavior tests. Do not retain compatibility wrappers around
  the deleted classes.

## Acceptance checks

- Every connection entry path reaches one controller and uses the same stable
  profile identity, attempt ordering, disposal, hydration, and error semantics.
- A late event from any retired client cannot dispose, replace, or change UI
  state for the current client.
- Retry always targets the current profile/controller even after the old client
  has been disposed or several automatic attempts have failed.
- A mounted terminal accepts no input while stale/reconnecting and accepts
  ordered input immediately after replacement hydration without recreation of
  its PTY or duplicate output.
- UI cannot report connected or hide the recovery failure while a post-recovery
  application command still cannot reach the server.
- Static dependency and source checks prove the superseded gates, recovery
  classes, captured retry callbacks, and duplicate activation paths are gone.

## Definition of done

One connection controller owns activation and recovery across renderer hosts,
all old lifecycle mechanisms are deleted, mounted workspaces recover
atomically, and focused state-machine, client, workspace, and terminal tests
pass.
